import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setIdentity, type Customer } from "./support/session";

// Feature 9 in docs/overview/feature-readiness.md: Support. Intercom's
// Messenger is a fake script that records what Aura asks of it; Aura's pages,
// the identity token route, controls, and D1 run for real.

type Call = [string, ...unknown[]];
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __intercomCalls?: Call[] }).__intercomCalls ?? []);
const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString()) as Record<string, unknown>;

async function openSupport(page: Page, path = "/app/support") {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "0" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  await page.goto(path);
  await expect(path.startsWith("/app/support") ? page.getByRole("heading", { name: "Get help" }) : page.getByRole("link", { name: "Contact support" }))
    .toBeVisible({ timeout: 30_000 });
  return customer;
}

/** The Messenger was booted as this customer, with a server-signed identity token and Aura's own launcher. */
async function expectIdentified(page: Page, customer: Customer) {
  await expect.poll(async () => (await calls(page)).find((call) => call[0] === "boot"), { timeout: 20_000 }).toBeTruthy();
  const [, settings] = (await calls(page)).find((call) => call[0] === "boot")! as [string, Record<string, string | boolean>];
  expect(settings).toMatchObject({ app_id: "e2eapp", user_id: customer.userId, wallet_address: customer.wallet.toLowerCase(), hide_default_launcher: true });
  const token = String(settings.intercom_user_jwt);
  expect(token.split(".")).toHaveLength(3);
  expect(decode(token.split(".")[1])).toMatchObject({ user_id: customer.userId, email: customer.email });
  expect(token).not.toContain("e2e-intercom-identity-secret");
}

test.beforeEach(async () => { await edge("/__reset"); });

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app/support", "/api/support/messenger"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("chat opens as the signed-in customer, identified by a token Aura signs", async ({ page }) => {
  const customer = await openSupport(page);
  await expectIdentified(page, customer);
  const opened = page.waitForRequest((request) => request.url().endsWith("/api/analytics/events") && request.postDataJSON()?.eventName === "support_opened");
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect.poll(async () => (await calls(page)).some((call) => call[0] === "show")).toBe(true);
  expect((await opened).postDataJSON()).toMatchObject({ surface: "/app/support", properties: { prefilled: false } });
  await expect(page.getByRole("link", { name: "Open" })).toHaveAttribute("href", /\/$/);
  // What was retired is gone: no in-house case form.
  await expect(page.getByText("Open support case")).toHaveCount(0);
});

test("someone else using the account: Support points to the lock in Settings, and opens a chat to report it", async ({ page }) => {
  const customer = await openSupport(page);
  await expectIdentified(page, customer);
  const row = page.getByRole("listitem").filter({ hasText: "Someone else may be using my account" });
  // Locking and unlocking live in Settings; Support doesn't change the account's controls.
  await expect(row.getByRole("link", { name: "Lock in Settings" })).toHaveAttribute("href", "/app/settings#emergency-lock");
  await row.getByRole("button", { name: "Tell us" }).click();
  await expect.poll(async () => (await calls(page)).find((call) => call[0] === "showNewMessage"))
    .toEqual(["showNewMessage", "Someone else may be using my Aura account."]);
  expect(await asCustomer(page, customer, "GET", "/api/security/policy")).toMatchObject({ policy: { accountLocked: false } });
  await row.getByRole("link", { name: "Lock in Settings" }).click();
  await expect(page).toHaveURL(/\/app\/settings#emergency-lock$/);
  await expect(page.getByRole("checkbox", { name: /Emergency lock/ })).toBeVisible({ timeout: 30_000 });
});

test("money sent to a scam: Aura says it can't be reversed, and opens a chat to report it", async ({ page }) => {
  const customer = await openSupport(page);
  await expectIdentified(page, customer);
  await expect(page.getByText(/Crypto transfers can't be reversed by Aura or anyone else\./)).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "I sent money to a scam" }).getByRole("button", { name: "Tell us" }).click();
  await expect.poll(async () => (await calls(page)).find((call) => call[0] === "showNewMessage")?.[1]).toMatch(/^I sent money to a scam or the wrong address\./);
});

test("closing an account starts from Settings and opens a chat asking for it", async ({ page }) => {
  const customer = await openSupport(page, "/app/settings#data");
  await page.getByRole("link", { name: "Contact support" }).click();
  await expect(page).toHaveURL(/\/app\/support\?topic=close-account$/);
  await expectIdentified(page, customer);
  await page.getByRole("button", { name: "Ask to close" }).click();
  await expect.poll(async () => (await calls(page)).find((call) => call[0] === "showNewMessage")?.[1])
    .toBe("I'd like to close my Aura account. I've moved all my money out.");
});

test("chat that can't load says so, instead of buttons that do nothing, and Try again loads it", async ({ page }) => {
  // An ad blocker, the network, or the Content Security Policy can stop Intercom's script.
  let blocked = true;
  await page.route("https://widget.intercom.io/**", (route) => blocked ? route.abort("blockedbyclient") : route.fallback());
  const customer = await openSupport(page);
  await expect(page.getByText("Chat can't be loaded right now. Try again, or read the help articles.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Chat", exact: true })).toHaveCount(0);
  for (const button of await page.getByRole("button", { name: "Tell us" }).all()) await expect(button).toBeDisabled();
  await expect(page.getByText(/Chat is unavailable right now\./)).toHaveCount(2);
  // Once the script can load, Try again brings chat back without reloading the page.
  blocked = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Chat", exact: true })).toBeEnabled({ timeout: 20_000 });
  await expectIdentified(page, customer);
  for (const button of await page.getByRole("button", { name: "Tell us" }).all()) await expect(button).toBeEnabled();
});

test("an account that can't load offers chat on the screen that blocks the app", async ({ page }) => {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setIdentity(page, customer, { signedIn: true });
  await page.route("**/api/terms", (route) => route.fulfill({ status: 500, json: { error: "unavailable" } }));
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Your account can’t be loaded right now" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Chat with support" }).click({ timeout: 20_000 });
  await expect.poll(async () => (await calls(page)).find((call) => call[0] === "showNewMessage")).toEqual(["showNewMessage", "My Aura account won't load."]);
  await expectIdentified(page, customer);
});

test("a closed account's Support page says the account is closed", async ({ page }) => {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  // Any request the server refuses as closed shows the closed screen; Support stays open.
  await page.route("**/api/overview**", (route) => route.fulfill({ status: 403, json: { error: "account_closed", message: "This account is closed." } }));
  await page.goto("/app");
  await page.getByTestId("account-closed").getByRole("link", { name: "Contact support" }).click({ timeout: 30_000 });
  await expect(page.getByText("Your account is closed. Chat with us if you think this is a mistake.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Chat", exact: true })).toBeEnabled({ timeout: 20_000 });
  // Settings shows the closed screen, so Support doesn't send the customer there.
  await expect(page.getByRole("link", { name: "Lock in Settings" })).toHaveCount(0);
  await expect(page.getByText("Tell us what happened.", { exact: true })).toBeVisible();
});
