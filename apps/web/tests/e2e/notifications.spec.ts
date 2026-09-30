import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
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
  await expect(panel.getByText(/^From 0x5555…5555, on Base\.$/)).toBeVisible();
  await expect(count(page)).toHaveCount(0);
  // It stays read after a reload, and the notice links to the transaction.
  await page.reload();
  await expect(bell(page)).toBeVisible({ timeout: 30_000 });
  await expect(count(page)).toHaveCount(0);
  await bell(page).click();
  await page.getByRole("dialog", { name: "Notifications" }).getByRole("link", { name: /Received 5 USDC/ }).click();
  await expect(page).toHaveURL(/\/app\/transactions\?open=/);
});

test("with transaction emails off, money received isn't emailed, but a security notice still is", async ({ page }) => {
  test.setTimeout(150_000);
  const customer = await signIn(page);
  await page.goto("/app/settings#notifications");
  const emails = page.getByRole("button", { name: "Transaction emails" });
  await expect(emails).toHaveText("On", { timeout: 30_000 });
  await emails.click();
  await expect(emails).toHaveText("Off");

  await edge("/__receive", { chainId: 8453, to: customer.wallet, token: ASSETS.usdc, amount: "2000000", from: FRIEND });
  await waitForNotice(page, "1");
  await expect(toast(page, "Received 2 USDC")).toBeVisible();

  await area(page, "Security");
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => emailsTo(customer), { timeout: 20_000 }).toEqual(["Your account is locked"]);
  const email = (await outbox()).emails.find((item) => item.to.includes(customer.email))!;
  expect(email.text).toContain("If this wasn't you, lock your account in Settings and contact support.");
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
  const push = page.getByRole("button", { name: "Browser notifications" });
  await expect(push).toHaveText("Off", { timeout: 30_000 });
  await push.click();
  await expect(push).toHaveText("On", { timeout: 20_000 });

  await area(page, "Security");
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await outbox()).pushes.filter((item) => item.subscription === customer.userId.slice(-12)).map((item) => item.title), { timeout: 20_000 })
    .toEqual(["Your account is locked"]);
  expect((await outbox()).pushes[0]).toMatchObject({ link: "/app/settings", body: expect.stringContaining("Nothing can be sent until you unlock it") });

  await area(page, "Notifications");
  await push.click();
  await expect(push).toHaveText("Off", { timeout: 20_000 });
});

test("a browser that blocks notifications says so", async ({ page, context }) => {
  await signIn(page);
  await context.clearPermissions();
  await page.addInitScript(() => { Object.defineProperty(Notification, "permission", { get: () => "denied" }); });
  await page.goto("/app/settings#notifications");
  await expect(page.getByText(/Blocked for Aura in this browser's settings\./)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Browser notifications" })).toHaveCount(0);
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
  await dialog.getByRole("button", { name: "Confirm and send" }).click();
  await expect(toast(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  await returnToTab(page);
  await expect(count(page)).toHaveText("1", { timeout: 15_000 });
  await page.locator(".toastRegion").getByRole("button", { name: "Close" }).first().click();
  await bell(page).click();
  await expect(page.getByRole("dialog", { name: "Notifications" }).getByText(/10 USDC/)).toBeVisible();
  await expect(page.locator(".toastRegion").getByText(/10 USDC/)).toHaveCount(0);
});

test("a customer who signed up with a wallet adds an email, verified by Privy, and then gets email notices there", async ({ page }) => {
  const customer = await signIn(page, { email: false });
  // Settings shows one area at a time: notifications, then security, where the email is.
  await page.goto("/app/settings#notifications");
  await expect(page.getByText("Add an email in Security to get notices by email.")).toBeVisible({ timeout: 30_000 });
  // No email yet: nothing to toggle, and product news isn't offered.
  await expect(page.getByRole("button", { name: "Transaction emails" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Product news" })).toHaveCount(0);
  await area(page, "Security");
  await expect(page.getByText("Add an email to get notices by email and to sign in without your wallet.")).toBeVisible({ timeout: 30_000 });

  // Closing Privy's email flow changes nothing.
  await page.getByRole("button", { name: "Add email" }).click();
  await expect(page.getByText("Add an email to get notices by email and to sign in without your wallet.")).toBeVisible();

  await page.evaluate(() => localStorage.setItem("aura-e2e-link-email", "new-owner@example.com"));
  await page.getByRole("button", { name: "Add email" }).click();
  await expect(toast(page, "Email added")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("new-owner@example.com. Used to sign in and for email notices.")).toBeVisible();
  await area(page, "Notifications");
  await expect(page.getByRole("button", { name: "Transaction emails" })).toHaveText("On");
  await expect(page.getByRole("button", { name: "Product news" })).toHaveText("Off");
  await area(page, "Security");

  // Aura reads the address from Privy when it sends, so the next notice goes there.
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  await expect.poll(async () => (await outbox()).emails.filter((email) => email.to.includes("new-owner@example.com")).map((email) => email.subject), { timeout: 20_000 })
    .toEqual(["Your account is locked"]);
  expect(customer.email).toBe("");
});
