import type { BrowserContext, Page } from "@playwright/test";
import { OPERATOR } from "./support/fake-edge.mjs";
import { expect, outcome, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, operatorHeaders, setBalances, setFeature, setIdentity } from "./support/session";

// Feature 12 in docs/overview/feature-readiness.md: the operations console,
// apps/ops. Cloudflare Access is the local fake: tests add its signed token
// to the ops app's API calls, as Access does in front of the real app. The ops
// app, the web app's operator APIs, and D1 run for real.

const OPS = `http://127.0.0.1:${process.env.AUREL_E2E_OPS_PORT ?? "43175"}`;
const WEB = `http://localhost:${process.env.AUREL_E2E_PORT ?? "43173"}`;
const FRIEND = "0x5555555555555555555555555555555555555555";

/** Let Cloudflare Access in front of the ops app sign this browser's requests, as a given operator, or with a forged token. */
async function signedInToOps(context: BrowserContext, options: { forged?: boolean; none?: boolean } = {}) {
  await context.route(`${OPS}/api/**`, async (route) => route.continue({
    headers: { ...route.request().headers(), ...(options.none ? {} : await operatorHeaders({ forged: options.forged })) } }));
}

async function openOps(page: Page, hash = "customers") {
  // The ops dev server starts alongside the web app; wait for it the first time.
  await expect.poll(async () => (await fetch(OPS).catch(() => null))?.status ?? 0, { timeout: 60_000 }).toBe(200);
  await page.goto(`${OPS}/#${hash}`);
}

const customers = (page: Page) => page.getByRole("region", { name: "Customers", exact: true });
const customerCard = (page: Page) => page.getByTestId("ops-customer");

async function find(page: Page, query: string) {
  await customers(page).getByRole("textbox", { name: "Customer" }).fill(query);
  await customers(page).getByRole("button", { name: "Find" }).click();
}

async function reasonAction(page: Page, label: string, reason: string) {
  await customerCard(page).getByRole("button", { name: label }).click();
  const form = customerCard(page).getByRole("form", { name: label });
  await form.getByLabel("Reason").fill(reason);
  await form.getByRole("button", { name: `Confirm: ${label.toLowerCase()}` }).click();
}

test.beforeEach(async () => { await edge("/__reset"); });

test("only an operator Cloudflare Access signed in reaches operations", async ({ page, context, browser }) => {
  await signedInToOps(context);
  await openOps(page);
  await expect(page.locator(".who")).toHaveText(OPERATOR.email, { timeout: 30_000 });
  // The top bar fits any window: the page never scrolls sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  for (const options of [{ none: true }, { forged: true }]) {
    const other = await browser.newContext();
    await signedInToOps(other, options);
    const outsider = await other.newPage();
    await outsider.goto(`${OPS}/#customers`);
    await expect(outsider.getByRole("alert")).toContainText("You're signed out of operations. Reload the page to sign in.", { timeout: 30_000 });
    await expect(outsider.getByRole("region", { name: "Customers", exact: true })).toHaveCount(0);
    await other.close();
  }
  // A customer's Privy session is never an operator's.
  const customer = await newCustomer();
  expect((await page.request.get(`${WEB}/api/ops/features`, { headers: { Authorization: `Bearer ${customer.token}` } })).status()).toBe(401);
  expect((await page.request.get(`${WEB}/api/ops/features`, { headers: await operatorHeaders({ audience: "another-app" }) })).status()).toBe(403);
  // The console isn't in the customer app any more.
  expect((await page.request.get(`${WEB}/app/operations`)).status()).toBe(404);
});

test("an operator finds a customer, locks the account, and closes it only once it's empty; the customer sees it", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "2500000" } });
  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  await acceptTerms(customerPage, customer);

  await signedInToOps(context);
  await openOps(page);
  await find(page, customer.email);
  await expect(customerCard(page)).toContainText(customer.userId, { timeout: 30_000 });
  await expect(customerCard(page)).toContainText("Open");
  await expect(customerCard(page)).toContainText("It still holds USD Coin");
  // The operator sees who it is and how much they hold.
  await expect(customerCard(page).getByRole("heading", { name: customer.email })).toBeVisible();
  await expect(customerCard(page)).toContainText("2.5 USDC");
  await expect(customerCard(page).getByRole("button", { name: "Close account" })).toBeDisabled();
  await expect(customerCard(page)).toContainText(`Intercom user ID${customer.userId}`);

  // Lock it: the customer's sending stops at once, and they're told.
  await reasonAction(page, "Lock account", "Customer reported a stolen phone");
  await expect(customerCard(page).locator(".badge").filter({ hasText: "Locked" })).toBeVisible({ timeout: 30_000 });
  await expect(customerCard(page).getByRole("button", { name: "Lock account" })).toHaveCount(0);
  expect(await asCustomer(customerPage, customer, "GET", "/api/security/policy")).toMatchObject({ policy: { accountLocked: true } });
  await expect.poll(async () => (await edge("/__outbox")).emails?.some((email) => email.to.includes(customer.email) && email.subject.includes("locked")), { timeout: 30_000 }).toBe(true);
  // The notice shows on the customer, with how its email went.
  await expect.poll(async () => {
    await customers(page).getByRole("button", { name: "Find" }).click();
    return customerCard(page).getByTestId("ops-notices").locator("tr").filter({ hasText: "Your account is locked" }).textContent({ timeout: 5_000 }).catch(() => "");
  }, { timeout: 30_000 }).toContain("Sent");

  // Emptied, it can be closed, with a reason.
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "0" } });
  await customers(page).getByRole("button", { name: "Find" }).click();
  await expect(customerCard(page).getByRole("button", { name: "Close account" })).toBeEnabled({ timeout: 30_000 });
  await reasonAction(page, "Close account", "Support case 42");
  await expect(customerCard(page)).toContainText("Support case 42", { timeout: 30_000 });
  await expect(customerCard(page).locator(".badge").filter({ hasText: "Closed" })).toBeVisible();

  await setIdentity(customerPage, customer, { signedIn: true });
  await customerPage.goto(`${WEB}/app`);
  await expect(customerPage.getByTestId("account-closed")).toContainText("This account is closed", { timeout: 30_000 });
  await customerPage.getByRole("link", { name: "Contact support" }).click();
  await expect(customerPage.getByRole("heading", { name: "Get help" })).toBeVisible({ timeout: 30_000 });
  await customerContext.close();

  // Reopening needs a reason too, and the account stays locked for the customer to unlock.
  await reasonAction(page, "Reopen account", "Customer came back");
  await expect(customerCard(page).locator(".badge").filter({ hasText: "Open" })).toBeVisible({ timeout: 30_000 });
  await expect(customerCard(page).locator(".badge").filter({ hasText: "Locked" })).toBeVisible();

  // A search that matches nobody says so.
  await find(page, "nobody@example.com");
  await expect(customers(page).getByRole("alert")).toContainText("No customer matches that search.", { timeout: 30_000 });
});

test("the customer list shows everyone, newest first, and opens each customer", async ({ page, context }) => {
  const customer = await newCustomer();
  await acceptTerms(page, customer);
  await signedInToOps(context);
  await openOps(page);
  const list = page.getByRole("region", { name: "All customers" });
  const row = list.getByTestId("ops-customer-row").first();
  // The newest sign-up is first.
  await expect(row).toContainText(customer.email, { timeout: 30_000 });
  await expect(row).toContainText("Open");
  await row.click();
  await expect(customerCard(page)).toContainText(customer.userId, { timeout: 30_000 });
  await expect(list).toHaveCount(0);
  // The open customer is in the address, so a reload (or a copied link) comes back to them.
  await expect(page).toHaveURL(`${OPS}/#customers?subject=${encodeURIComponent(customer.userId)}`);
  await page.reload();
  await expect(customerCard(page)).toContainText(customer.userId, { timeout: 30_000 });
  await customers(page).getByRole("button", { name: "All customers" }).click();
  await expect(page).toHaveURL(`${OPS}/#customers`);
  await expect(page.getByRole("region", { name: "All customers" }).getByTestId("ops-customer-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(customerCard(page)).toHaveCount(0);
});

test("money movement lists every customer's transactions, filters them, and opens each one's journey", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  await setFeature(page, "direct_transfers", true);
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "50000000" } });
  const customerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  await acceptTerms(customerPage, customer);
  await setIdentity(customerPage, customer, { signedIn: true });
  await customerPage.goto(`${WEB}/app/send`);
  const dialog = customerPage.getByRole("region", { name: "Send crypto" });
  await dialog.getByLabel("Amount").fill("10");
  await dialog.getByLabel("To").fill(FRIEND);
  await dialog.getByRole("button", { name: "Review" }).click();
  // A first-time address is checked before the review (B2).
  await dialog.getByRole("button", { name: "It's correct" }).click();
  await dialog.getByRole("button", { name: "Confirm and send" }).click();
  await expect(outcome(customerPage, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  await customerContext.close();

  // Money that arrived from outside Aura: on chain, not an Aura action.
  await edge("/__receive", { chainId: 8453, to: customer.wallet, token: ASSETS.usdc, amount: "7000000", from: FRIEND });

  await signedInToOps(context);
  await openOps(page);
  await find(page, customer.email);
  await customerCard(page).getByRole("button", { name: "Money movement" }).click();
  const movement = page.getByRole("region", { name: "Money movement" });
  await expect(movement.locator(".chip")).toContainText("Customer");
  // One customer's view is everything on their account, as in their Transactions.
  const entries = movement.getByTestId("ops-history-entry");
  const received = entries.filter({ hasText: "Received" });
  await expect(received).toContainText("7 USDC", { timeout: 30_000 });
  await expect(received).toContainText("Alchemy");
  const sent = entries.filter({ hasText: "Sent" });
  await expect(sent).toContainText("10 USDC");
  await expect(sent).toContainText("Completed");

  await sent.getByRole("button", { name: "Sent" }).click();
  const journey = page.getByRole("dialog", { name: "Action journey" });
  await expect(journey).toContainText(customer.userId, { timeout: 30_000 });
  await expect(journey).toContainText(`to ${FRIEND}`);
  await expect(journey.locator(".events li").first()).toBeVisible();
  await expect(journey.getByRole("link", { name: "Transaction" })).toHaveAttribute("href", /basescan\.org\/tx\/0x[0-9a-f]{64}$/);
  await expect(journey.getByRole("button", { name: "Check the chain now" })).toHaveCount(0);
  // Keyboard users land in the journey, Tab stays in it, and Escape takes them back to the row they opened it from.
  await expect(journey).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(journey.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(journey.getByRole("link", { name: "Transaction" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(journey).toHaveCount(0);
  await expect(sent.getByRole("button", { name: "Sent" })).toBeFocused();
  await sent.getByRole("button", { name: "Sent" }).click();
  await journey.getByRole("button", { name: "Close" }).click();

  // Everyone's Aura actions, filtered.
  await movement.getByRole("button", { name: "Show everyone" }).click();
  await expect(movement.locator(".chip")).toHaveCount(0);
  const mine = movement.getByTestId("ops-action").filter({ hasText: customer.userId.slice(-6) });
  await expect(mine.filter({ hasText: "Sent" })).toContainText("10 USDC", { timeout: 30_000 });
  // Money received from outside Aura is in everyone's feed too, recorded when the chain was read.
  await expect(mine.filter({ hasText: "Received" })).toContainText("7 USDC");
  await expect(mine.filter({ hasText: "Received" })).toContainText("Alchemy");
  await movement.getByLabel("Kind").selectOption("received");
  await expect(mine.filter({ hasText: "Sent" })).toHaveCount(0, { timeout: 30_000 });
  await expect(mine.filter({ hasText: "Received" })).toHaveCount(1);
  await movement.getByLabel("Kind").selectOption("");
  // Status and stuck are about Aura actions: received money drops out too.
  await movement.getByLabel("Status").selectOption("failed");
  await expect(mine).toHaveCount(0, { timeout: 30_000 });
  await movement.getByLabel("Status").selectOption("");
  await movement.getByLabel("Stuck only").check();
  await expect(mine).toHaveCount(0, { timeout: 30_000 });
});

test("stats show customers, activity, and the new-customer funnel", async ({ page, context }) => {
  const customer = await newCustomer();
  await acceptTerms(page, customer);
  await signedInToOps(context);
  await openOps(page, "stats");
  const stats = page.getByRole("region", { name: "Stats" });
  await expect(stats.getByTestId("stat-customers")).not.toHaveText("0", { timeout: 30_000 });
  await expect(stats.getByTestId("funnel-step").first()).toContainText("Signed up");
  await expect(stats.getByTestId("funnel-step")).toHaveCount(4);
  await stats.getByRole("button", { name: "7 days" }).click();
  await expect(stats.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true");
  // A header and one row per day, today included, once days with no activity are shown too.
  await stats.getByLabel("Show days with no activity").check();
  await expect(stats.getByRole("table").last().getByRole("row")).toHaveCount(1 + 8, { timeout: 30_000 });
});

test("controls: switches, asset pauses, and issues, each recorded with the operator", async ({ page, context }) => {
  await signedInToOps(context);
  await openOps(page, "controls");
  const switches = page.getByRole("region", { name: "Feature switches" });
  const swap = switches.getByRole("switch", { name: "Swap", exact: true });
  await expect(swap).toBeVisible({ timeout: 30_000 });
  const before = await swap.getAttribute("aria-checked");
  // Every change asks to confirm, with a reason that's shown and audited.
  const change = async (reason: string) => {
    await switches.getByRole("switch", { name: "Swap", exact: true }).click();
    const form = switches.getByRole("form", { name: /^Turn (on|off) Swap$/ });
    await form.getByLabel("Reason").fill(reason);
    await form.getByRole("button", { name: /for everyone$/ }).click();
  };
  await change("Launch gate drill");
  await expect(swap).toHaveAttribute("aria-checked", before === "true" ? "false" : "true", { timeout: 30_000 });
  await expect(switches.getByText(`by ${OPERATOR.email}: Launch gate drill`).first()).toBeVisible();
  await change("Drill over");
  await expect(swap).toHaveAttribute("aria-checked", before ?? "false", { timeout: 30_000 });

  const pauses = page.getByRole("region", { name: "Asset pauses" });
  const usdc = pauses.getByTestId("ops-asset").filter({ hasText: "USDC on Base" });
  await usdc.getByRole("button", { name: "Pause" }).click();
  await usdc.getByRole("form", { name: "Pause USDC" }).getByLabel("Reason").fill("Issuer halt drill");
  await usdc.getByRole("form", { name: "Pause USDC" }).getByRole("button", { name: "Pause" }).click();
  await expect(usdc).toContainText(`by ${OPERATOR.email}: Issuer halt drill`, { timeout: 30_000 });
  await usdc.getByRole("button", { name: "Resume" }).click();
  await expect(usdc.getByRole("button", { name: "Pause" })).toBeVisible({ timeout: 30_000 });

  // Issues have their own page.
  await page.getByRole("navigation", { name: "Operations" }).getByRole("link", { name: "Issues" }).click();
  const issues = page.getByRole("region", { name: "Issues" });
  await issues.getByRole("button", { name: "Look for stuck actions and failed events" }).click();
  await expect(issues.getByRole("status")).toContainText("No stuck actions or failed events found.", { timeout: 30_000 });
});
