import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setIdentity, type Customer } from "./support/session";

// Feature 9 in docs/overview/feature-readiness.md: Support. Intercom's
// Messenger is a fake script that records what Aura asks of it; Aura's pages,
// the identity token route, controls, and D1 run for real.

type Call = [string, ...unknown[]];
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __intercomCalls?: Call[] }).__intercomCalls ?? []);
const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
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
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect.poll(async () => (await calls(page)).some((call) => call[0] === "show")).toBe(true);
  await expect(page.getByRole("link", { name: "Open" })).toHaveAttribute("href", /\/getting-started\/setup\/$/);
  // What was retired is gone: no in-house case form.
  await expect(page.getByText("Open support case")).toHaveCount(0);
});

test("someone else using the account: Aura locks it first, then opens a chat about it", async ({ page }) => {
  const customer = await openSupport(page);
  await expectIdentified(page, customer);
  await page.getByRole("button", { name: "Lock and report" }).click();
  await expect(toast(page, "Account locked")).toBeVisible({ timeout: 20_000 });
  expect(await asCustomer(page, customer, "GET", "/api/security/policy")).toMatchObject({ policy: { accountLocked: true } });
  // Locked: Support says so and points to Settings to unlock, instead of offering the lock again.
  await expect(page.getByText("Your account is locked")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock and report" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Unlock in Settings" })).toHaveAttribute("href", "/app/settings");
  await expect.poll(async () => (await calls(page)).find((call) => call[0] === "showNewMessage"))
    .toEqual(["showNewMessage", "Someone else may be using my Aura account. I locked it from Support."]);
});

test("money sent to a scam: Aura says it can't be reversed, and opens a chat to report it", async ({ page }) => {
  const customer = await openSupport(page);
  await expectIdentified(page, customer);
  await expect(page.getByText(/Blockchain transfers can't be reversed by Aura or anyone else\./)).toBeVisible();
  await page.getByRole("button", { name: "Tell us" }).click();
  await expect.poll(async () => (await calls(page)).find((call) => call[0] === "showNewMessage")?.[1]).toMatch(/^I sent money to a scam or the wrong address\./);
});

test("closing an account starts from Settings and opens a chat asking for it", async ({ page }) => {
  const customer = await openSupport(page, "/app/settings");
  await page.getByRole("link", { name: "Contact support" }).click();
  await expect(page).toHaveURL(/\/app\/support\?topic=close-account$/);
  await expectIdentified(page, customer);
  await page.getByRole("button", { name: "Ask to close" }).click();
  await expect.poll(async () => (await calls(page)).find((call) => call[0] === "showNewMessage")?.[1])
    .toBe("Please close my Aura account. I've moved all my money out.");
});
