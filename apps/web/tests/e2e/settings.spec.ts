import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setIdentity, type Customer } from "./support/session";

// Feature 8 in docs/overview/feature-readiness.md: Settings and security.
// Privy (sessions, the passkey prompt, and wallet signing) and the chain are
// the local fake; Aura's pages, API routes, controls, and D1 run for real.

const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
const lock = (page: Page) => page.getByRole("checkbox", { name: /Emergency lock/ });
const limit = (page: Page) => page.getByRole("spinbutton", { name: /Daily transfer limit/ });

/** Settings shows one area at a time, named in the URL's hash. */
async function openSettings(page: Page, options: { mfa?: string[]; usdc?: string; area?: string; heading?: string } = {}) {
  const customer = await newCustomer({ mfa: options.mfa ?? ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: options.usdc ?? "0" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  await page.goto(`/app/settings#${options.area ?? "security"}`);
  if (options.area) await expect(page.getByRole("heading", { name: options.heading })).toBeVisible({ timeout: 30_000 });
  else await expect(lock(page)).toBeVisible({ timeout: 30_000 });
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
  await page.getByRole("button", { name: "Save daily limit" }).click();
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
  await page.getByRole("button", { name: "Save daily limit" }).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  expect(await policy(page, customer)).toMatchObject({ dailyLimitUsd: 1000 });
});

test("without a passkey, loosening asks the customer to add one and changes nothing", async ({ page }) => {
  const customer = await openSettings(page, { mfa: [] });
  await expect(page.getByRole("button", { name: "Add passkey" })).toBeVisible();
  await lock(page).click();
  await expect(toast(page, "Controls updated")).toBeVisible({ timeout: 20_000 });
  await dismissToasts(page);
  await lock(page).click();
  await expect(toast(page, "Add a passkey first")).toBeVisible({ timeout: 20_000 });
  expect(await policy(page, customer)).toMatchObject({ accountLocked: true });
});

test("an authenticator app counts as the passkey", async ({ page }) => {
  await openSettings(page, { mfa: ["totp"] });
  await expect(page.getByText(/^Added\. Needed to move money/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add passkey" })).toHaveCount(0);
});

test("saved recipients can be added, wait their turn, and be removed", async ({ page }) => {
  await openSettings(page, { area: "recipients", heading: "Saved recipients" });
  await page.getByLabel("Name", { exact: true }).fill("Treasury");
  await page.getByLabel("Wallet address").fill("0x5555555555555555555555555555555555555555");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(toast(page, "Recipient saved")).toBeVisible({ timeout: 20_000 });
  const entry = page.getByRole("list", { name: "Saved recipients" }).getByRole("listitem").filter({ hasText: "Treasury" });
  await expect(entry).toContainText("Waiting");
  // Removing asks once, on the row: Keep leaves it, Remove removes it.
  await entry.getByRole("button", { name: "Remove Treasury" }).click();
  await entry.getByRole("button", { name: "Keep" }).click();
  await expect(entry).toContainText("Waiting");
  await entry.getByRole("button", { name: "Remove Treasury" }).click();
  await entry.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(toast(page, "Recipient removed")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("No saved recipients yet.")).toBeVisible();
});

test("an Aura tag can be saved and published", async ({ page }) => {
  const customer = await openSettings(page, { area: "tag", heading: "Aura tag and payment page" });
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
  // Only the ways that work (B6): crypto, no card payment, and no bank transfer unless its details were shared.
  await expect(page.getByRole("heading", { name: "Crypto" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Card payment" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Bank transfer" })).toHaveCount(0);
  // Someone with Aura pays in the app, with the tag filled in (B5).
  await page.getByRole("link", { name: "Send with Aura" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/send\\?sendTo=${customer.wallet}&tag=${tag}$`, "i"));
  await expect(page.getByRole("region", { name: "Send crypto" }).getByLabel("To")).toHaveValue(new RegExp(`^${customer.wallet}$`, "i"), { timeout: 30_000 });
  // The summary beside the form names the tag (it's hidden on the phone, where the review does).
  if (page.viewportSize()!.width >= 768) await expect(page.getByRole("region", { name: "Summary" })).toContainText(`@${tag}`);
});

test("the customer's data downloads straight away, and nothing offers to delete it", async ({ page }) => {
  const customer = await openSettings(page, { area: "data", heading: "Your data and account" });
  await expect(page.getByText("Delete my data")).toHaveCount(0);
  // Only what the customer can use: no placeholders, no recovery review (Privy's wallets recover through the sign-in methods), no feedback box.
  for (const gone of ["Sessions", "Passcode", "Wallet provider rules", "Recovery", "You stay in control", "Tell us what got in the way", "Statements"]) await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const data = JSON.parse(await readFile((await file.path())!, "utf8")) as { subjectReference: string; data: Record<string, unknown> };
  expect(data.subjectReference).toBe(customer.userId);
  expect(data.data).toHaveProperty("security_profiles");
  await expect(page.getByRole("link", { name: "Contact support" })).toHaveAttribute("href", "/app/support?topic=close-account");
});

test("exporting the account key asks first and says what the controls can't cover", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByText(/Your lock, daily limit, and saved recipients only don't apply in another wallet/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Export key" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
});

test("an area that can't load says so with Try again, and the Aura tag form never shows empty", async ({ page }) => {
  let fail = true;
  await page.route("**/api/aura-tags", (route) => fail ? route.fulfill({ status: 503, json: { error: "aura_tag_unavailable" } }) : route.fallback());
  await openSettings(page, { area: "tag", heading: "Aura tag and payment page" });
  await expect(page.getByRole("alert").filter({ hasText: "We couldn't load your Aura tag." })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Tag", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save Aura tag" })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Tag", { exact: true })).toBeVisible({ timeout: 20_000 });
});
