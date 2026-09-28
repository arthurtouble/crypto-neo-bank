import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { OPERATOR } from "./support/fake-edge.mjs";
import { expect, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setIdentity, type Customer } from "./support/session";

// Feature 8 in docs/overview/feature-readiness.md: Settings and security.
// Privy (sessions, the passkey prompt, and wallet signing) and the chain are
// the local fake; Aura's pages, API routes, controls, and D1 run for real.

const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
const lock = (page: Page) => page.getByRole("checkbox", { name: /Emergency lock/ });
const limit = (page: Page) => page.getByRole("spinbutton", { name: /Daily transfer limit/ });

async function openSettings(page: Page, options: { mfa?: string[]; usdc?: string } = {}) {
  const customer = await newCustomer({ mfa: options.mfa ?? ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: options.usdc ?? "0" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  await page.goto("/app/settings");
  await expect(lock(page)).toBeVisible({ timeout: 30_000 });
  return customer;
}

const policy = async (page: Page, customer: Customer) =>
  (await asCustomer(page, customer, "GET", "/api/security/policy") as { policy: { accountLocked: boolean; dailyLimitUsd: number | null } }).policy;
const dismissToasts = (page: Page) => page.locator(".toastRegion").getByRole("button", { name: "Close" }).first().click().catch(() => undefined);

test.beforeEach(async () => { await edge("/__reset"); });

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app/settings", "/app/operations", "/api/security/policy"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("tightening a control applies at once; loosening it needs the passkey", async ({ page }) => {
  const customer = await openSettings(page);
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  expect(await policy(page, customer)).toMatchObject({ accountLocked: true });
  await dismissToasts(page);

  await limit(page).fill("100");
  await limit(page).blur();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  expect(await policy(page, customer)).toMatchObject({ dailyLimitUsd: 100 });
  await dismissToasts(page);

  // Cancelling the passkey prompt changes nothing.
  await page.evaluate(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  await lock(page).click();
  await expect(toast(page, "Controls not changed")).toBeVisible({ timeout: 20_000 });
  expect(await policy(page, customer)).toMatchObject({ accountLocked: true });
  await expect(lock(page)).toBeChecked();
  await dismissToasts(page);

  // Confirming with the passkey unlocks it, and raises the limit.
  await page.evaluate(() => localStorage.removeItem("aura-e2e-passkey"));
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  expect(await policy(page, customer)).toMatchObject({ accountLocked: false });
  await dismissToasts(page);
  await limit(page).fill("1000");
  await limit(page).blur();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  expect(await policy(page, customer)).toMatchObject({ dailyLimitUsd: 1000 });
});

test("without a passkey, loosening asks the customer to add one and changes nothing", async ({ page }) => {
  const customer = await openSettings(page, { mfa: [] });
  await expect(page.getByText("No passkey yet")).toBeVisible();
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  await dismissToasts(page);
  await lock(page).click();
  await expect(toast(page, "Add a passkey first")).toBeVisible({ timeout: 20_000 });
  expect(await policy(page, customer)).toMatchObject({ accountLocked: true });
});

test("an authenticator app counts as the passkey", async ({ page }) => {
  await openSettings(page, { mfa: ["totp"] });
  await expect(page.getByText("Passkey added")).toBeVisible();
});

test("saved recipients can be added, wait their turn, and be removed", async ({ page }) => {
  await openSettings(page);
  await page.getByLabel("Label").fill("Treasury");
  await page.getByLabel("EVM address").fill("0x5555555555555555555555555555555555555555");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toast(page, "Recipient saved")).toBeVisible({ timeout: 20_000 });
  const entry = page.locator(".addressList > div").filter({ hasText: "Treasury" });
  await expect(entry).toContainText("Waiting");
  await entry.getByRole("button", { name: "Remove Treasury" }).click();
  await expect(toast(page, "Recipient removed")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("No saved recipients yet.")).toBeVisible();
});

test("an Aura tag can be saved and published", async ({ page }) => {
  const customer = await openSettings(page);
  const tag = `t${customer.userId.slice(-10)}`;
  // The form fills itself from the saved tag once that loads; type after that.
  await expect(async () => {
    await page.getByLabel("Tag", { exact: true }).fill(tag);
    await page.getByLabel("Public display name").fill("Test Customer");
    await page.waitForTimeout(300);
    await expect(page.getByLabel("Tag", { exact: true })).toHaveValue(tag);
  }).toPass({ timeout: 20_000 });
  await page.getByLabel("Show my payment page publicly").check();
  await page.getByRole("button", { name: "Save Aura tag" }).click();
  await expect(toast(page, "Aura tag saved")).toBeVisible({ timeout: 20_000 });
  await page.goto(`/pay/${tag}`);
  await expect(page.getByText("Test Customer")).toBeVisible({ timeout: 30_000 });
});

test("the customer's data downloads straight away, and nothing offers to delete it", async ({ page }) => {
  const customer = await openSettings(page);
  await expect(page.getByText("Delete my data")).toHaveCount(0);
  for (const placeholder of ["Sessions", "Passcode", "Wallet provider rules"]) await expect(page.getByText(placeholder, { exact: true })).toHaveCount(0);
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const data = JSON.parse(await readFile((await file.path())!, "utf8")) as { subjectReference: string; data: Record<string, unknown> };
  expect(data.subjectReference).toBe(customer.userId);
  expect(data.data).toHaveProperty("security_profiles");
  await expect(page.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/app/support?topic=close-account");
});

test("an operator closes an account only once it's empty; the customer then sees it's closed", async ({ page, browser }) => {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "2500000" } });
  await acceptTerms(page, customer);

  const { token } = await edge("/__session", { userId: OPERATOR.userId });
  const operator: Customer = { userId: OPERATOR.userId, wallet: OPERATOR.wallet as `0x${string}`, email: "operator@example.com", token: token!, externalWallets: [] };
  const opsPage = await browser.newPage();
  await acceptTerms(opsPage, operator);
  await setIdentity(opsPage, operator, { signedIn: true });
  await opsPage.goto("/app/operations");
  const accounts = opsPage.getByRole("region", { name: "Accounts" });
  await accounts.getByLabel("Customer").fill(customer.email);
  await accounts.getByRole("button", { name: "Find" }).click();
  await expect(accounts.getByTestId("ops-account")).toContainText("It still holds USD Coin", { timeout: 30_000 });
  await expect(accounts.getByRole("button", { name: "Close account" })).toBeDisabled();

  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "0" } });
  await accounts.getByRole("button", { name: "Find" }).click();
  await expect(accounts.getByRole("button", { name: "Close account" })).toBeEnabled({ timeout: 30_000 });
  opsPage.once("dialog", (dialog) => void dialog.accept("Support case 42"));
  await accounts.getByRole("button", { name: "Close account" }).click();
  await expect(accounts.getByTestId("ops-account")).toContainText("Reason: Support case 42", { timeout: 30_000 });
  await opsPage.close();

  await setIdentity(page, customer, { signedIn: true });
  await page.goto("/app");
  await expect(page.getByTestId("account-closed")).toContainText("This account is closed", { timeout: 30_000 });
  // Support stays open.
  await page.getByRole("link", { name: "Contact support" }).click();
  await expect(page.getByRole("heading", { name: "Contact support" })).toBeVisible({ timeout: 30_000 });
});
