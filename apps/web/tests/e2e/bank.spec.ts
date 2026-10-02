import type { Page } from "@playwright/test";
import { BRIDGE } from "./support/fake-edge.mjs";
import { expect, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setControls, setFeature, setIdentity, type Customer } from "./support/session";

// Feature 10 in docs/overview/feature-readiness.md: Bank and cards, the bank
// half. Bridge (identity verification, the USD account, saved banks, and
// payouts), Privy, and the chain are the local fake; Aura's pages, API routes,
// actions, and D1 run for real.

const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
const depositPanel = (page: Page) => page.getByRole("region", { name: "Deposit from a bank" });
const sendPanel = (page: Page) => page.getByRole("region", { name: "Send to a bank" });

async function signIn(page: Page, usdc = "0") {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: usdc } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  return customer;
}

/** A customer Bridge has already verified, with their USD account open, as after the first test. */
async function verified(page: Page, customer: Customer) {
  await asCustomer(page, customer, "POST", "/api/money/onboarding", { fullName: "Jane Customer", email: customer.email });
  await edge("/__bridge/kyc", { email: customer.email });
  expect(await asCustomer(page, customer, "GET", "/api/money/account")).toMatchObject({ account: { state: "active" } });
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "fiat_accounts", true);
  await setFeature(page, "direct_transfers", true);
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await setFeature(page, "fiat_accounts", false);
  await page.close();
});

test("a customer verifies with Bridge, gets US bank details, and a bank deposit arrives as USDC", async ({ page, context }) => {
  test.setTimeout(120_000);
  const customer = await signIn(page);
  // Bridge's hosted verification page.
  await context.route("https://bridge.aura-e2e.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Verify your identity with Bridge</h1>" }));
  await page.goto("/app/deposit#bank");
  await depositPanel(page).getByLabel("Full legal name").fill("Jane Customer");
  await expect(depositPanel(page).getByLabel("Email")).toHaveValue(customer.email);
  // Bridge hosts identity verification in a new tab.
  const [bridgeTab] = await Promise.all([context.waitForEvent("page"), depositPanel(page).getByRole("button", { name: "Verify with Bridge" }).click()]);
  await expect.poll(() => bridgeTab.url()).toMatch(/^https:\/\/bridge\.aura-e2e\.test\/kyc\//);
  await bridgeTab.close();
  await expect(depositPanel(page).getByRole("link", { name: "Continue verification" })).toBeVisible({ timeout: 20_000 });

  // Bridge approves the customer; checking again opens their USD account.
  await edge("/__bridge/kyc", { email: customer.email });
  await depositPanel(page).getByRole("button", { name: "Check status" }).click();
  await expect(depositPanel(page).getByText("900123456789")).toBeVisible({ timeout: 20_000 });
  await expect(depositPanel(page).getByText("101019644")).toBeVisible();
  await expect(depositPanel(page).getByText("Bank transfer, Wire")).toBeVisible();

  // Dollars sent to those details arrive as USDC, shown as a bank deposit from the sender, not Bridge's address.
  await edge("/__bridge/deposit", { email: customer.email, amount: "25", senderName: "Jane Customer" });
  await page.goto("/app/transactions");
  const row = page.locator(".activityRow").filter({ hasText: "Bank deposit" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("25 USDC");
  await expect(row).toContainText("Jane Customer");
  await expect(page.locator(".activityRow").filter({ hasText: BRIDGE.sender.slice(0, 6) })).toHaveCount(0);
  await row.click();
  await expect(page.getByRole("dialog")).toContainText("From");
  await expect(page.getByRole("dialog")).toContainText("Jane Customer");
});

test("verification Bridge rejects says so and offers no account", async ({ page }) => {
  const customer = await signIn(page);
  await asCustomer(page, customer, "POST", "/api/money/onboarding", { fullName: "Jane Customer", email: customer.email });
  await edge("/__bridge/kyc", { email: customer.email, status: "rejected" });
  await page.goto("/app/deposit#bank");
  await expect(depositPanel(page).getByText("Bridge couldn't verify your identity. Contact support.")).toBeVisible({ timeout: 30_000 });
  await page.goto("/app/send#bank");
  await expect(sendPanel(page).getByText(/Set up your bank account on/)).toBeVisible({ timeout: 30_000 });
});

test("a customer saves a bank account and sends to it; Transactions follows Bridge until the bank has it", async ({ page }) => {
  test.setTimeout(150_000);
  const customer = await signIn(page, "100000000");
  await verified(page, customer);
  await page.goto("/app/send#bank");
  await sendPanel(page).getByRole("button", { name: "Add bank account" }).click();
  const form = sendPanel(page).getByRole("form", { name: "Add bank account" });
  await form.getByLabel("Account holder name").fill("Jane Customer");
  await form.getByLabel("Bank name").fill("Chase");
  await form.getByLabel("Account number").fill("123456789");
  await form.getByLabel("Routing number").fill("021000021");
  await form.getByLabel("Street address").fill("1 Test Street");
  await form.getByLabel("City").fill("New York");
  await form.getByLabel("State").fill("NY");
  await form.getByLabel("ZIP code").fill("10001");
  await form.getByRole("button", { name: "Save bank account" }).click();
  await expect(toast(page, "Bank account saved")).toBeVisible({ timeout: 20_000 });

  const payout = sendPanel(page).getByRole("form", { name: "Send to a bank" });
  await expect(payout.getByLabel("To")).toContainText("Chase •••• 6789");
  await payout.getByLabel("Amount in USD").fill("25");
  // A review comes before the passkey (B1): nothing is prepared or sent until the customer confirms.
  await payout.getByRole("button", { name: "Review" }).click();
  const review = sendPanel(page).getByRole("region", { name: "Review bank transfer" });
  await expect(review.getByTestId("bank-review")).toContainText("$25.00");
  await expect(review.getByTestId("bank-review")).toContainText("Chase •••• 6789");
  await expect(review.getByTestId("bank-review")).toContainText("Usually 1 to 3 business days");
  expect((await edge("/__sent")).sent).toHaveLength(0);
  // Edit keeps what was entered.
  await review.getByRole("button", { name: "Edit" }).click();
  await expect(payout.getByLabel("Amount in USD")).toHaveValue("25");
  await payout.getByRole("button", { name: "Review" }).click();
  await review.getByRole("button", { name: "Confirm and send" }).click();
  await expect(toast(page, "Bank transfer sent")).toBeVisible({ timeout: 30_000 });
  // Exactly the payout amount went to the address Bridge named.
  const { sent } = await edge("/__sent");
  const funding = sent!.find((item) => item.relayed);
  expect(funding?.from).toBe(customer.wallet.toLowerCase());

  await page.goto("/app/transactions");
  const row = page.locator(".activityRow").filter({ hasText: "Sent to bank" });
  await expect(row).toContainText("25 USDC", { timeout: 30_000 });
  await expect(row).toContainText("Pending");
  await row.click();
  await expect(page.getByTestId("bank-status")).toHaveText("Waiting for your USDC to reach Bridge");
  await page.keyboard.press("Escape");

  // Bridge pays the bank: the payout completes, and the customer is told.
  await edge("/__bridge/transfer", { state: "payment_processed" });
  await page.reload();
  await expect(row).toContainText("Completed", { timeout: 30_000 });
  await row.click();
  await expect(page.getByTestId("bank-status")).toHaveText("Arrived at your bank");
  expect(((await asCustomer(page, customer, "GET", "/api/notifications")).notifications as Array<{ title: string }>).map((item) => item.title))
    .toContain("25 USDC arrived at your bank");
});

test("a payout the bank returns shows as failed with what Bridge is doing about it", async ({ page }) => {
  test.setTimeout(120_000);
  const customer = await signIn(page, "100000000");
  await verified(page, customer);
  const bank = await asCustomer(page, customer, "POST", "/api/money/bank-accounts", { accountOwnerName: "Jane Customer", bankName: "Chase", accountNumber: "123456789",
    routingNumber: "021000021", checkingOrSavings: "checking", address: { streetLine1: "1 Test Street", city: "New York", state: "NY", postalCode: "10001", country: "USA" } });
  expect(bank).toMatchObject({ bankAccount: { lastFour: "6789" } });
  await page.goto("/app/send#bank");
  const payout = sendPanel(page).getByRole("form", { name: "Send to a bank" });
  await payout.getByLabel("Amount in USD").fill("10");
  await payout.getByRole("button", { name: "Review" }).click();
  await sendPanel(page).getByRole("region", { name: "Review bank transfer" }).getByRole("button", { name: "Confirm and send" }).click();
  await expect(toast(page, "Bank transfer sent")).toBeVisible({ timeout: 30_000 });
  await edge("/__bridge/transfer", { state: "returned" });
  await page.goto("/app/transactions");
  const row = page.locator(".activityRow").filter({ hasText: "Sent to bank" });
  await expect(row).toContainText("Failed", { timeout: 30_000 });
  await row.click();
  await expect(page.getByTestId("bank-status")).toHaveText("Your bank returned it. Bridge is sending the money back");
});

test("the server refuses a payout while the account is locked, before Bridge creates anything", async ({ page }) => {
  const customer = await signIn(page, "100000000");
  await verified(page, customer);
  await asCustomer(page, customer, "POST", "/api/money/bank-accounts", { accountOwnerName: "Jane Customer", bankName: "Chase", accountNumber: "123456789",
    routingNumber: "021000021", checkingOrSavings: "checking", address: { streetLine1: "1 Test Street", city: "New York", state: "NY", postalCode: "10001", country: "USA" } });
  await asCustomer(page, customer, "PATCH", "/api/security/policy", { accountLocked: true });
  const { recipients } = await asCustomer(page, customer, "GET", "/api/recipients") as { recipients: Array<{ id: string; kind: string }> };
  const response = await page.request.post("/api/money/payouts", { headers: { Authorization: `Bearer ${customer.token}` },
    data: { bankAccountId: recipients.find((item) => item.kind === "bank")!.id, amountUsd: "10" } });
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({ error: "account_locked" });
});

test("while bank accounts are switched off, Deposit and Send say they're coming soon", async ({ page }) => {
  await setFeature(page, "fiat_accounts", false);
  await signIn(page);
  await page.goto("/app/deposit#bank");
  await expect(depositPanel(page).getByText("Coming soon", { exact: true })).toBeVisible({ timeout: 30_000 });
  const customer = await newCustomer();
  await acceptTerms(page, customer);
  const response = await page.request.post("/api/money/onboarding", { headers: { Authorization: `Bearer ${customer.token}` }, data: { fullName: "Jane Customer", email: customer.email } });
  expect(response.status()).toBe(503);
});

test("a new bank account says when it can receive, and a saved one can be removed", async ({ page }) => {
  test.setTimeout(120_000);
  const customer = await signIn(page, "100000000");
  await verified(page, customer);
  await setControls(page, customer, { enforceAddressBook: true });
  await asCustomer(page, customer, "POST", "/api/money/bank-accounts", { accountOwnerName: "Jane Customer", bankName: "Chase", accountNumber: "123456789",
    routingNumber: "021000021", checkingOrSavings: "checking", address: { streetLine1: "1 Test Street", city: "New York", state: "NY", postalCode: "10001", country: "USA" } });
  await page.goto("/app/send#bank");
  const saved = sendPanel(page).getByTestId("saved-bank");
  // With saved recipients only on, it waits like a new recipient, and the payout form isn't offered yet.
  await expect(saved).toContainText("Ready from", { timeout: 30_000 });
  await expect(sendPanel(page).getByRole("form", { name: "Send to a bank" })).toHaveCount(0);

  await saved.getByRole("button", { name: "Remove Chase •••• 6789" }).click();
  await saved.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(toast(page, "Bank account removed")).toBeVisible({ timeout: 20_000 });
  await expect(saved).toHaveCount(0);
  const { recipients } = await asCustomer(page, customer, "GET", "/api/recipients") as { recipients: Array<{ kind: string }> };
  expect(recipients.filter((item) => item.kind === "bank")).toEqual([]);
});
