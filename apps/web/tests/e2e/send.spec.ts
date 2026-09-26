import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer } from "./support/session";

// Feature 3 in docs/overview/feature-readiness.md: sending from the Aura
// account on Base. The passkey prompt, Privy's sponsored relay, and the chain
// are the local fake; Aura's pages, API routes, controls, verifier, and D1
// run for real. The relayed operation is a real EntryPoint handleOps with a
// Kernel batch, so the verifier checks it exactly as on Base.

const RECIPIENT = "0x5555555555555555555555555555555555555555";
const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
const dialog = (page: Page) => page.getByRole("dialog");
const relayed = async () => ((await edge("/__sent")).sent ?? []).filter((item) => item.relayed);

async function balance(page: Page, customer: Customer, id: string) {
  const overview = await asCustomer(page, customer, "GET", "/api/overview") as { holdings: Array<{ id: string; amountRaw: string | null }> };
  return overview.holdings.find((item) => item.id === id)?.amountRaw ?? "0";
}

/** A customer with a passkey and 50 USDC, on the Send page. */
async function openSend(page: Page, options: { mfa?: string[]; balances?: Record<string, string>; connectedWallet?: boolean } = {}) {
  const customer = await newCustomer({ mfa: options.mfa ?? ["passkey"], connectedWallet: options.connectedWallet });
  await setBalances(customer.wallet, { 8453: options.balances ?? { [ASSETS.usdc]: "50000000" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  await page.goto("/app/send");
  await expect(page.getByRole("heading", { name: "Send crypto" })).toBeVisible({ timeout: 30_000 });
  return customer;
}

async function fillSend(page: Page, input: { asset?: string; amount: string; to?: string }) {
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  if (input.asset) await dialog(page).getByLabel("Asset").selectOption(input.asset);
  await dialog(page).getByLabel("Amount").fill(input.amount);
  if (input.to !== undefined) await dialog(page).getByLabel("To").fill(input.to);
}

async function reviewAndConfirm(page: Page) {
  await dialog(page).getByRole("button", { name: "Review" }).click();
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "direct_transfers", true);
});

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app/send", "/api/overview", "/api/recipients"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("USDC goes to an address after a review, with the fee paid by Aura, and the chain confirms it", async ({ page }) => {
  const customer = await openSend(page);
  await fillSend(page, { amount: "12.5", to: RECIPIENT });
  await dialog(page).getByRole("button", { name: "Review" }).click();

  const review = page.getByTestId("send-review");
  await expect(review).toContainText("12.5 USDC");
  await expect(review).toContainText(RECIPIENT);
  await expect(review).toContainText("Base");
  await expect(review).toContainText("Paid by Aura");
  expect(await relayed()).toEqual([]);

  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(toast(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  const [operation] = await relayed();
  expect(operation).toMatchObject({ from: customer.wallet.toLowerCase(), success: true });
  expect(operation.calls).toHaveLength(1);
  expect(operation.calls![0].to.toLowerCase()).toBe(ASSETS.usdc);
  expect(await balance(page, customer, `8453:${ASSETS.usdc}`)).toBe("37500000");
});

test("until the block is final, a matched transfer shows as sent", async ({ page }) => {
  await edge("/__state", { finalizeAll: false });
  await openSend(page);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(toast(page, "Transfer sent")).toBeVisible({ timeout: 30_000 });
  await expect(dialog(page).getByText("Transfer sent")).toBeVisible();
});

test("ETH and cbBTC can be sent too", async ({ page }) => {
  const customer = await openSend(page, { balances: { native: "1000000000000000000", [ASSETS.cbbtc]: "100000000" } });
  await fillSend(page, { asset: "cbBTC", amount: "0.25", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(toast(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  expect(await balance(page, customer, `8453:${ASSETS.cbbtc}`)).toBe("75000000");
  await page.locator(".toastRegion").getByRole("button", { name: "Close" }).click();

  await dialog(page).getByRole("button", { name: "New transfer" }).click();
  await dialog(page).getByLabel("Asset").selectOption("ETH");
  await dialog(page).getByLabel("Amount").fill("0.1");
  await dialog(page).getByLabel("To").fill(RECIPIENT);
  await reviewAndConfirm(page);
  await expect(toast(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => balance(page, customer, "8453:native")).toBe("900000000000000000");
});

test("Max fills the whole balance, and more than the balance is refused before review", async ({ page }) => {
  await openSend(page);
  await fillSend(page, { amount: "60", to: RECIPIENT });
  await expect(dialog(page).getByText("50 USDC available")).toBeVisible({ timeout: 20_000 });
  await dialog(page).getByRole("button", { name: "Review" }).click();
  await expect(dialog(page).getByText("That's more USDC than you have.")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Max" }).click();
  await expect(dialog(page).getByLabel("Amount")).toHaveValue("50");
});

test("bad input is caught before anything is prepared", async ({ page }) => {
  const customer = await openSend(page);
  const check = async (amount: string, to: string, message: string) => {
    await dialog(page).getByLabel("Amount").fill(amount);
    await dialog(page).getByLabel("To").fill(to);
    await dialog(page).getByRole("button", { name: "Review" }).click();
    await expect(dialog(page).getByText(message)).toBeVisible();
  };
  await fillSend(page, { amount: "1" });
  await check("1", "0x123", "Enter a valid address.");
  await check("1", customer.wallet, "This is your own Aura address.");
  await check("0", RECIPIENT, "Enter an amount greater than zero.");
  await check("1.1234567", RECIPIENT, "Use at most 6 decimal places.");
  expect(await relayed()).toEqual([]);
});

test("the server refuses a token contract as the recipient", async ({ page }) => {
  await openSend(page);
  await fillSend(page, { amount: "1", to: ASSETS.usdc });
  await reviewAndConfirm(page);
  await expect(toast(page, "Transfer not sent")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".toastRegion")).toContainText("token contract");
  expect(await relayed()).toEqual([]);
});

test("the customer can send to their own connected wallet in one tap", async ({ page }) => {
  const customer = await openSend(page, { connectedWallet: true });
  const own = customer.externalWallets[0];
  await fillSend(page, { amount: "2" });
  await dialog(page).getByRole("button", { name: `Send to my wallet · ${own.slice(0, 6)}…${own.slice(-4)}` }).click();
  await dialog(page).getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("send-review")).toContainText("Your wallet");
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(toast(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
});

test("a saved recipient can be picked by name", async ({ page }) => {
  const customer = await openSend(page);
  await asCustomer(page, customer, "PATCH", "/api/security/policy", { newAddressDelayHours: 0 });
  await asCustomer(page, customer, "POST", "/api/security/addresses", { address: RECIPIENT, label: "Sam" });
  await page.reload();
  await fillSend(page, { amount: "3" });
  await dialog(page).getByLabel("Saved recipient").selectOption({ label: `Sam · ${RECIPIENT.slice(0, 6)}…${RECIPIENT.slice(-4)}` });
  await dialog(page).getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("send-review")).toContainText("Sam");
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(toast(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
});

test("an Aura tag is found, checked again before signing, and shown in the review", async ({ page }) => {
  const payee = await newCustomer();
  const tag = `sam${payee.wallet.slice(2, 10).toLowerCase()}`;
  await acceptTerms(page, payee);
  await asCustomer(page, payee, "PUT", "/api/aura-tags", { tag, address: payee.wallet, displayName: "Sam", publicEnabled: true });
  await openSend(page);
  await page.getByLabel("Aura tag").fill(`@${tag}`);
  await page.getByRole("button", { name: "Find recipient" }).click();
  await expect(dialog(page)).toBeVisible({ timeout: 20_000 });
  await expect(dialog(page).getByLabel("To")).toHaveValue(payee.wallet);
  await dialog(page).getByLabel("Amount").fill("4");
  await dialog(page).getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("send-review")).toContainText(`@${tag}`);
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(toast(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  expect(await balance(page, payee, `8453:${ASSETS.usdc}`)).toBe("4000000");
});

test("an unknown Aura tag isn't found", async ({ page }) => {
  await openSend(page);
  await page.getByLabel("Aura tag").fill("@nobody-here");
  await page.getByRole("button", { name: "Find recipient" }).click();
  await expect(page.getByText("This Aura tag is unavailable.")).toBeVisible();
});

test("the customer's controls are enforced on the server: daily limit, saved recipients only, waiting period, and lock", async ({ page }) => {
  const customer = await openSend(page);
  const attempt = async (message: string) => {
    await fillSend(page, { amount: "12.5", to: RECIPIENT });
    await reviewAndConfirm(page);
    await expect(page.locator(".toastRegion")).toContainText(message, { timeout: 20_000 });
    await page.keyboard.press("Escape");
    await page.reload();
  };
  await asCustomer(page, customer, "PATCH", "/api/security/policy", { dailyLimitUsd: 10 });
  await attempt("This would go over your daily limit.");
  await asCustomer(page, customer, "PATCH", "/api/security/policy", { dailyLimitUsd: null, enforceAddressBook: true });
  await attempt("Your settings only allow sending to saved recipients.");
  await asCustomer(page, customer, "POST", "/api/security/addresses", { address: RECIPIENT, label: "Sam" });
  await attempt("This saved recipient is still in its waiting period.");
  await asCustomer(page, customer, "PATCH", "/api/security/policy", { enforceAddressBook: false, accountLocked: true });
  await attempt("Your account is locked.");
  expect(await relayed()).toEqual([]);
});

test("without a passkey nothing is sent, and Privy's passkey setup opens", async ({ page }) => {
  await openSend(page, { mfa: [] });
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(toast(page, "Add a passkey to move money")).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __auraE2E?: { mfaEnrollment: number } }).__auraE2E?.mfaEnrollment)).toBe(1);
  expect(await relayed()).toEqual([]);
});

test("cancelling the passkey prompt sends nothing", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  await openSend(page);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(toast(page, "Cancelled")).toBeVisible({ timeout: 20_000 });
  expect(await relayed()).toEqual([]);
});

test("while sending is switched off, the customer is told and nothing is sent", async ({ page }) => {
  await setFeature(page, "direct_transfers", false);
  await openSend(page);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(toast(page, "Transfer not sent")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".toastRegion")).toContainText("temporarily unavailable");
  expect(await relayed()).toEqual([]);
});

test("a paused asset can't be sent", async ({ page }) => {
  const { token } = await edge("/__session", { userId: "did:privy:e2e-operator" });
  await openSend(page);
  await page.request.patch("/api/ops/assets", { headers: { Authorization: `Bearer ${token}`, Connection: "close" }, data: { assetId: `8453:${ASSETS.usdc}`, paused: true, reason: "Test" } });
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(page.locator(".toastRegion")).toContainText("USDC is paused right now", { timeout: 20_000 });
  await page.request.patch("/api/ops/assets", { headers: { Authorization: `Bearer ${token}`, Connection: "close" }, data: { assetId: `8453:${ASSETS.usdc}`, paused: false } });
  expect(await relayed()).toEqual([]);
});

test("when Privy refuses the request, nothing is sent", async ({ page }) => {
  await edge("/__state", { relay: "reject" });
  await openSend(page);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(toast(page, "Transfer not sent")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".toastRegion")).toContainText("Nothing was sent");
  expect(await relayed()).toEqual([]);
});

test("when Privy's answer is lost, the customer is told to check Transactions before retrying", async ({ page }) => {
  await edge("/__state", { relay: "error" });
  await openSend(page);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(toast(page, "Check Transactions first")).toBeVisible({ timeout: 30_000 });
  await expect(dialog(page).getByRole("button", { name: "Check Transactions first" })).toBeDisabled();
});

test("an operation that reverts on chain is reported as failed, and nothing moves", async ({ page }) => {
  const customer = await openSend(page);
  await edge("/__state", { relay: "revert" });
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(toast(page, "Transfer failed")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".toastRegion")).toContainText("The network rejected it. Nothing moved.");
  expect(await balance(page, customer, `8453:${ASSETS.usdc}`)).toBe("50000000");
});

test("bank transfers are shown as coming soon", async ({ page }) => {
  await openSend(page);
  const bank = page.getByRole("region", { name: "Send to a bank" });
  await expect(bank.getByText("Coming soon", { exact: true })).toBeVisible();
});
