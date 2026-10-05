import type { Page } from "@playwright/test";
import { expect, outcome, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer } from "./support/session";

// Feature 8 in docs/overview/feature-readiness.md: Settings and security, its
// notifications. Privy, the chain (and Alchemy's transfer index over it),
// Resend, and the browser's push service are the local fake; Aura's pages,
// API routes, notices, and D1 run for real.

const FRIEND = "0x5555555555555555555555555555555555555555";
const edgePort = process.env.AUREL_E2E_EDGE_PORT ?? "43174";
const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
const bell = (page: Page) => page.getByRole("button", { name: /^Notifications/ });
const count = (page: Page) => page.getByTestId("notification-count");
const lock = (page: Page) => page.getByRole("checkbox", { name: /Emergency lock/ });
/** Settings shows one area at a time; on the phone, go back to the list of areas first. */
async function area(page: Page, name: string) {
  const back = page.getByRole("button", { name: "All settings" });
  if (await back.isVisible()) await back.click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: new RegExp(`^${name}`) }).click();
}
const outbox = async () => { const { emails, pushes } = await edge("/__outbox"); return { emails: emails!, pushes: pushes! }; };
const emailsTo = async (customer: Customer) => (await outbox()).emails.filter((email) => email.to.includes(customer.email)).map((email) => email.subject);

async function signIn(page: Page, options: { email?: boolean } = {}) {
  const customer = await newCustomer({ mfa: ["passkey"], ...options });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "50000000" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  // Opening the app starts watching the account for money received; only money that arrives after that is announced.
  await asCustomer(page, customer, "GET", "/api/notifications");
  return customer;
}

/** What the browser does when the customer comes back to the tab. */
const returnToTab = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

/**
 * Money received is checked for at most every 30 seconds per account. The app
 * checks again when the customer comes back to the tab; this does that until
 * the bell shows the notice.
 */
async function waitForNotice(page: Page, unread: string) {
  await expect(async () => {
    await returnToTab(page);
    await expect(count(page)).toHaveText(unread, { timeout: 3_000 });
  }).toPass({ timeout: 75_000, intervals: [5_000] });
}

test.beforeEach(async () => { await edge("/__reset"); });

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app", "/app/settings", "/api/notifications"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("money received shows in the bell with a toast, and by email; opening the list marks it read", async ({ page }) => {
  test.setTimeout(150_000);
  const customer = await signIn(page);
  await page.goto("/app");
  await expect(bell(page)).toBeVisible({ timeout: 30_000 });
  await expect(count(page)).toHaveCount(0);

  await edge("/__receive", { chainId: 8453, to: customer.wallet, token: ASSETS.usdc, amount: "5000000", from: FRIEND });
  await waitForNotice(page, "1");
  await expect(toast(page, "Received 5 USDC")).toBeVisible();
  await expect.poll(() => emailsTo(customer), { timeout: 20_000 }).toEqual(["Received 5 USDC"]);
  const email = (await outbox()).emails.find((item) => item.to.includes(customer.email))!;
  expect(email).toMatchObject({ from: "Aura <notices@aura-e2e.test>", text: expect.stringContaining("https://aura-e2e.test/app/transactions?open=") });

  await bell(page).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel.getByText("Received 5 USDC")).toBeVisible();
  await expect(panel.getByText(/^From 0x5555…5555\.$/)).toBeVisible();
  await expect(count(page)).toHaveCount(0);
  // It stays read after a reload, and the notice links to the transaction.
  await page.reload();
  await expect(bell(page)).toBeVisible({ timeout: 30_000 });
  await expect(count(page)).toHaveCount(0);
  await bell(page).click();
  await page.getByRole("dialog", { name: "Notifications" }).getByRole("link", { name: /Received 5 USDC/ }).click();
  await expect(page).toHaveURL(/\/app\/transactions\?open=/);
});

test("two notices arriving together both show as toasts, stacked; neither replaces the other", async ({ page }) => {
  test.setTimeout(150_000);
  const customer = await signIn(page);
  await page.goto("/app");
  await expect(bell(page)).toBeVisible({ timeout: 30_000 });

  await edge("/__receive", { chainId: 8453, to: customer.wallet, token: ASSETS.usdc, amount: "5000000", from: FRIEND });
  await edge("/__receive", { chainId: 8453, to: customer.wallet, token: ASSETS.usdc, amount: "8000000", from: FRIEND });
  await waitForNotice(page, "2");
  await expect(toast(page, "Received 5 USDC")).toBeVisible();
  await expect(toast(page, "Received 8 USDC")).toBeVisible();
});

test("with transaction emails off, money received isn't emailed, but a security notice still is", async ({ page }) => {
  test.setTimeout(150_000);
  const customer = await signIn(page);
  await page.goto("/app/settings#notifications");
  const emails = page.getByRole("checkbox", { name: "Transaction emails" });
  await expect(emails).toBeChecked({ timeout: 30_000 });
  await emails.click();
  await expect(emails).not.toBeChecked();

  await edge("/__receive", { chainId: 8453, to: customer.wallet, token: ASSETS.usdc, amount: "2000000", from: FRIEND });
  await waitForNotice(page, "1");
  await expect(toast(page, "Received 2 USDC")).toBeVisible();

  await area(page, "Security");
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => emailsTo(customer), { timeout: 20_000 }).toEqual(["Your account is locked"]);
  const email = (await outbox()).emails.find((item) => item.to.includes(customer.email))!;
  expect(email.text).toContain("If you didn't lock it, contact support.");
  // The security notice reaches the bell too.
  await returnToTab(page);
  await expect(count(page)).toHaveText("2", { timeout: 10_000 });
});

test("browser notifications can be turned on and off, and security notices are pushed", async ({ page, context }) => {
  const customer = await signIn(page);
  await context.grantPermissions(["notifications"]);
  // The browser's permission prompt says yes, and its push service is the local fake: Aura sends it the message, the way it would send Chrome's or Apple's.
  await page.addInitScript((endpoint) => {
    let permission: NotificationPermission = "default";
    Object.defineProperty(Notification, "permission", { get: () => permission });
    Notification.requestPermission = async () => (permission = "granted");
    let current: PushSubscription | null = null;
    const keys = { p256dh: `B${"A".repeat(86)}`, auth: "A".repeat(22) };
    PushManager.prototype.subscribe = async () => {
      current = { endpoint, toJSON: () => ({ endpoint, keys }), unsubscribe: async () => { current = null; return true; } } as unknown as PushSubscription;
      return current;
    };
    PushManager.prototype.getSubscription = async () => current;
  }, `http://127.0.0.1:${edgePort}/push/${customer.userId.slice(-12)}`);
  await page.goto("/app/settings#notifications");
  const push = page.getByRole("checkbox", { name: "Browser notifications" });
  await expect(push).not.toBeChecked({ timeout: 30_000 });
  await push.click();
  await expect(push).toBeChecked({ timeout: 20_000 });

  await area(page, "Security");
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await outbox()).pushes.filter((item) => item.subscription === customer.userId.slice(-12)).map((item) => item.title), { timeout: 20_000 })
    .toEqual(["Your account is locked"]);
  expect((await outbox()).pushes[0]).toMatchObject({ link: "/app/settings", body: expect.stringContaining("Nothing can be sent until you unlock it") });

  await area(page, "Notifications");
  await push.click();
  await expect(push).not.toBeChecked({ timeout: 20_000 });
});

test("a browser that blocks notifications says so", async ({ page, context }) => {
  await signIn(page);
  await context.clearPermissions();
  await page.addInitScript(() => { Object.defineProperty(Notification, "permission", { get: () => "denied" }); });
  await page.goto("/app/settings#notifications");
  await expect(page.getByText(/Blocked for Aura in this browser's settings\./)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("checkbox", { name: "Browser notifications" })).toHaveCount(0);
});

test("the customer's own transactions show in the bell without a second toast", async ({ page }) => {
  test.setTimeout(90_000);
  await setFeature(page, "direct_transfers", true);
  await setFeature(page, "cross_chain", false);
  await signIn(page);
  await page.goto("/app/send");
  const dialog = page.getByRole("region", { name: "Send crypto" });
  await dialog.getByLabel("Amount").fill("10");
  await dialog.getByLabel("To").fill(FRIEND);
  await dialog.getByRole("button", { name: "Review" }).click();
  // A first-time address is checked before the review (B2).
  await dialog.getByRole("button", { name: "It's correct" }).click();
  await dialog.getByRole("button", { name: "Send", exact: true }).click();
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  await returnToTab(page);
  await expect(count(page)).toHaveText("1", { timeout: 15_000 });
  await bell(page).click();
  await expect(page.getByRole("dialog", { name: "Notifications" }).getByText(/10 USDC/)).toBeVisible();
  await expect(page.locator(".toastRegion").getByText(/10 USDC/)).toHaveCount(0);
});

test("a customer who signed up with a wallet adds an email, verified by Privy, before using Aura, and gets email notices there", async ({ page }) => {
  const customer = await newCustomer({ mfa: ["passkey"], email: false });
  // The fake Privy session is set on each page load, so this test stays on one page once the email is added.
  await setIdentity(page, customer, { signedIn: true });
  await page.goto("/app/settings#notifications");
  await expect(page.getByRole("heading", { name: "Add your email" })).toBeVisible({ timeout: 30_000 });

  // Closing Privy's email flow changes nothing.
  await page.getByRole("button", { name: "Add email" }).click();
  await expect(page.getByRole("heading", { name: "Add your email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add email" })).toBeEnabled();

  await page.evaluate(() => localStorage.setItem("aura-e2e-link-email", "new-owner@example.com"));
  await page.getByRole("button", { name: "Add email" }).click();
  await expect(page.getByRole("heading", { name: "Review Aura’s terms" })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("new-owner@example.com", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("checkbox", { name: "Transaction emails" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Product news" })).not.toBeChecked();
  await area(page, "Security");
  await expect(page.getByText("new-owner@example.com. Used to sign in and for email notices.")).toBeVisible();

  // Aura reads the address from Privy when it sends, so the next notice goes there.
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await outbox()).emails.filter((email) => email.to.includes("new-owner@example.com")).map((email) => email.subject), { timeout: 20_000 })
    .toEqual(["Your account is locked"]);
  expect(customer.email).toBe("");
});
