import type { Page } from "@playwright/test";
import { expect, outcome, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, operatorHeaders, setBalances, setControls, setFeature, setIdentity, type Customer } from "./support/session";

// Feature 10 in docs/overview/feature-readiness.md: Bank and cards, the card
// half. Bridge (identity and card approval), Stripe Issuing (the card, its
// controls, purchases, and disputes), Stripe.js, Privy, and the chain are the
// local fake; Aura's pages, API routes, actions, and D1 run for real.

const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
const controls = (page: Page) => page.getByRole("region", { name: "Card controls" });
const allowance = (page: Page) => page.getByRole("region", { name: "Spending allowance" });
const activity = (page: Page) => page.getByRole("region", { name: "Card activity" });

async function signIn(page: Page, options: { mfa?: string[]; usdc?: string } = {}) {
  const customer = await newCustomer({ mfa: options.mfa ?? ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: options.usdc ?? "100000000" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  return customer;
}

/** Bridge has verified the customer and opened their USD account, as on Deposit. */
async function verified(page: Page, customer: Customer) {
  await asCustomer(page, customer, "POST", "/api/money/onboarding", { fullName: "Jane Customer", email: customer.email });
  await edge("/__bridge/kyc", { email: customer.email });
  await asCustomer(page, customer, "GET", "/api/money/account");
}

/** A customer with a card, as after the first test. */
async function withCard(page: Page, options: { usdc?: string } = {}) {
  const customer = await signIn(page, options);
  await verified(page, customer);
  await edge("/__bridge/cards", { email: customer.email });
  await asCustomer(page, customer, "POST", "/api/cards");
  return customer;
}

async function setAllowance(page: Page, amount: string) {
  await allowance(page).getByLabel("New allowance in USD").fill(amount);
  await allowance(page).getByRole("button", { name: "Set allowance" }).click();
  await expect(outcome(page, "Card allowance complete")).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "fiat_accounts", true);
  await setFeature(page, "payment_cards", true);
  await setFeature(page, "card_wallets", false);
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  for (const key of ["fiat_accounts", "payment_cards", "card_wallets"]) await setFeature(page, key, false);
  await page.close();
});

test("cards are coming soon while the card program is off", async ({ page }) => {
  await setFeature(page, "payment_cards", false);
  await signIn(page);
  await page.goto("/app/cards");
  await expect(page.getByRole("heading", { name: "Cards are coming soon" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Create my card" })).toHaveCount(0);
});

test("a verified customer applies with Bridge and creates a virtual card", async ({ page, context }) => {
  test.setTimeout(120_000);
  const customer = await signIn(page);
  await page.goto("/app/cards");
  // Identity comes first, once, under Add money.
  await expect(page.getByRole("heading", { name: "Verify your identity first" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Verify your identity" })).toHaveAttribute("href", "/app/deposit#bank");

  await verified(page, customer);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Apply for an Aura card" })).toBeVisible({ timeout: 20_000 });
  // Bridge hosts the card application in a new tab.
  await context.route("https://bridge.aura-e2e.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>Apply for a card with Bridge</h1>" }));
  const [bridgeTab] = await Promise.all([context.waitForEvent("page"), page.getByRole("button", { name: "Apply for a card" }).click()]);
  await expect.poll(() => bridgeTab.url()).toMatch(/^https:\/\/bridge\.aura-e2e\.test\/cards\/.+endorsement=cards$/);
  await bridgeTab.close();

  // Bridge needs more first; then approves.
  await edge("/__bridge/cards", { email: customer.email, status: "incomplete" });
  await page.getByRole("button", { name: "Check status" }).click();
  await expect(page.getByText("Bridge needs more before it can approve a card. (Confirm your address)")).toBeVisible({ timeout: 20_000 });
  await edge("/__bridge/cards", { email: customer.email });
  await page.getByRole("button", { name: "Check status" }).click();
  await expect(page.getByRole("heading", { name: "You're approved" })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Create my card" }).click();
  await expect(toast(page, "Your card is ready")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: /^Aura card ending \d{4}$/ })).toBeVisible();
  await expect(page.getByText("Daily limit $500.00.")).toBeVisible();
  // The card spends this account's USDC on Base, through Bridge.
  const { cards } = await edge("/__stripe/state") as unknown as { cards: Record<string, { crypto_wallet: { address: string; chain: string; currency: string } }> };
  expect(Object.values(cards)).toEqual([expect.objectContaining({ crypto_wallet: expect.objectContaining({ address: customer.wallet, chain: "base", currency: "usdc" }) })]);
});

test("without a passkey the card isn't created and the customer is asked to add one", async ({ page }) => {
  const customer = await signIn(page, { mfa: [] });
  await verified(page, customer);
  await edge("/__bridge/cards", { email: customer.email });
  await page.goto("/app/cards");
  await page.getByRole("button", { name: "Create my card" }).click();
  await expect(toast(page, "Add a passkey first")).toBeVisible({ timeout: 20_000 });
  expect(Object.keys((await edge("/__stripe/state") as unknown as { cards: object }).cards)).toHaveLength(0);
});

test("the card spends only up to the allowance, its payments are in Transactions, and one can be disputed", async ({ page }) => {
  test.setTimeout(120_000);
  const customer = await withCard(page);
  await page.goto("/app/cards");
  await expect(allowance(page).getByTestId("card-allowance")).toContainText("$0.00", { timeout: 20_000 });
  await expect(allowance(page).getByText("Set an allowance to start using your card.")).toBeVisible();

  // With no allowance, a purchase is declined and nothing leaves the account.
  expect(await edge("/__stripe/authorize", { amount: "12.50", merchant: "Bookshop" })).toMatchObject({ approved: false });

  // The customer approves the card to spend up to 50 USDC, with their passkey, like any action.
  await setAllowance(page, "50");
  await expect(allowance(page).getByTestId("card-allowance")).toContainText("$50.00", { timeout: 20_000 });

  // Bridge takes exactly the purchase from the account when Stripe approves it.
  expect(await edge("/__stripe/authorize", { amount: "12.50", merchant: "Corner Cafe" })).toMatchObject({ approved: true });
  await edge("/__stripe/capture");
  // More than what's left of the allowance is declined.
  expect(await edge("/__stripe/authorize", { amount: "40", merchant: "Electronics" })).toMatchObject({ approved: false });

  await page.reload();
  await expect(allowance(page).getByTestId("card-allowance")).toContainText("$37.50", { timeout: 20_000 });
  await expect(allowance(page).getByTestId("card-allowance")).toContainText("$87.50");
  const paid = activity(page).locator(".cardActivityRow").filter({ hasText: "Corner Cafe" });
  await expect(paid).toContainText("Paid");
  await expect(paid).toContainText("$12.50");
  await expect(activity(page).locator(".cardActivityRow").filter({ hasText: "Electronics" })).toContainText("Declined");
  await expect(activity(page).locator(".cardActivityRow").filter({ hasText: "Bookshop" })).toContainText("Declined");

  // Dispute the payment. A dispute can be sent once.
  await paid.getByRole("button", { name: "Dispute" }).click();
  const form = paid.getByRole("form", { name: "Dispute this payment" });
  await form.getByLabel("What happened?").selectOption("not_received");
  await form.getByLabel("Tell us more").fill("The order never arrived and the cafe doesn't answer.");
  await form.getByRole("button", { name: "Send dispute" }).click();
  await expect(toast(page, "Dispute sent")).toBeVisible({ timeout: 20_000 });
  await expect(paid).toContainText("Dispute under review", { timeout: 20_000 });
  await expect(paid.getByRole("button", { name: "Dispute" })).toHaveCount(0);

  // Card payments are in Transactions with every other money movement, under Card; setting the allowance is too, not as money sent.
  await page.goto("/app/transactions");
  const payment = page.locator(".activityRow").filter({ hasText: "Card payment" }).filter({ hasText: "Corner Cafe" });
  await expect(payment).toBeVisible({ timeout: 30_000 });
  await expect(payment).toContainText("$12.50");
  await expect(page.locator(".activityRow").filter({ hasText: "Card allowance set" })).toContainText("Aura card");
  await page.getByRole("group", { name: "Category" }).getByRole("button", { name: "Card", exact: true }).click();
  await expect(page.locator(".activityRow").filter({ hasText: "Card payment" })).toHaveCount(3);
  await payment.click();
  const receipt = page.getByRole("dialog");
  await expect(receipt).toContainText("Completed");
  await expect(receipt).toContainText("Under review");
  await expect(receipt.getByTestId("card-payment-note")).toContainText("Paid with your card from your USDC on Base");
  await expect(receipt.getByRole("link", { name: /View on the network/ })).toHaveAttribute("href", /basescan\.org\/tx\/0x[0-9a-f]{64}$/);
  await expect(receipt.getByRole("link", { name: "Open Cards" })).toHaveAttribute("href", "/app/cards");

  // Operators see the same purchases in the operations app's money movement, each once.
  const feed = await page.request.get(`/api/ops/movement?kind=card&subject=${encodeURIComponent(customer.userId)}`, { headers: await operatorHeaders() });
  expect(feed.status()).toBe(200);
  const { rows } = await feed.json() as { rows: Array<{ label: string; amountText: string; statusText: string; counterparty: string; source: string }> };
  expect(rows.map((row) => [row.counterparty, row.amountText, row.statusText]).sort()).toEqual([
    ["Bookshop", "12.50 USD", "Declined"], ["Corner Cafe", "12.50 USD", "Completed, dispute submitted"], ["Electronics", "40.00 USD", "Declined"]]);
  expect(rows.every((row) => row.label === "Card payment" && row.source === "Stripe")).toBe(true);
});

test("card holds and disputes read in plain words", async ({ page }) => {
  await withCard(page);
  const at = new Date().toISOString();
  const row = (id: string, status: string, merchant: string, dispute: { id: string; status: string } | null = null) =>
    ({ id, kind: "payment", status, amountUsd: "10.00", merchant, createdAt: at, transactionId: null, disputable: false, dispute, transactionHash: null, authorizationId: null });
  // Stripe's own states, from the card read; the fake doesn't release holds or rule on disputes, so this one is answered here.
  await page.route("**/api/cards", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const live = await (await route.fetch()).json() as Record<string, unknown>;
    await route.fulfill({ json: { ...live, activity: [row("hold", "pending", "Hotel"), row("released", "reversed", "Car rental"),
      row("won", "completed", "Shoe shop", { id: "du_1", status: "won" })] } });
  });
  await page.goto("/app/cards");
  const rowFor = (merchant: string) => activity(page).locator(".cardActivityRow").filter({ hasText: merchant });
  await expect(rowFor("Hotel")).toContainText("Pending", { timeout: 20_000 });
  await expect(rowFor("Hotel")).toContainText("Not final yet, the amount can change");
  await expect(rowFor("Car rental")).toContainText("Hold released");
  await expect(rowFor("Car rental")).toContainText("Nothing was taken");
  await expect(rowFor("Shoe shop")).toContainText("Dispute won");
});

test("turning off card spending sets the allowance to $0.00 on chain, with the passkey", async ({ page }) => {
  test.setTimeout(120_000);
  await withCard(page);
  await page.goto("/app/cards");
  await expect(allowance(page).getByTestId("card-allowance")).toContainText("$0.00", { timeout: 20_000 });
  // Nothing to turn off yet.
  await expect(allowance(page).getByRole("button", { name: "Turn off" })).toHaveCount(0);
  await setAllowance(page, "50");
  await expect(allowance(page).getByTestId("card-allowance")).toContainText("$50.00", { timeout: 20_000 });
  await allowance(page).getByRole("button", { name: "Change it again" }).click();

  // Cancelling the passkey prompt changes nothing.
  await page.evaluate(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  await allowance(page).getByRole("button", { name: "Turn off" }).click();
  await expect(toast(page, "Cancelled")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => localStorage.removeItem("aura-e2e-passkey"));

  await allowance(page).getByRole("button", { name: "Turn off" }).click();
  await expect(outcome(page, "Card allowance complete")).toBeVisible({ timeout: 30_000 });
  await expect(allowance(page).getByTestId("card-allowance")).toContainText("Card can spend$0.00", { timeout: 20_000 });
  await expect(allowance(page).getByText("Set an allowance to start using your card.")).toBeVisible();
  // With the allowance at 0, Bridge can't take anything for a purchase.
  expect(await edge("/__stripe/authorize", { amount: "5", merchant: "Corner Cafe" })).toMatchObject({ approved: false });

  await page.goto("/app/transactions");
  await expect(page.locator(".activityRow").filter({ hasText: "Card spending turned off" })).toContainText("Aura card", { timeout: 30_000 });
});

test("freezing stops payments at once; unfreezing and a higher limit need the passkey", async ({ page }) => {
  test.setTimeout(120_000);
  const customer = await withCard(page);
  await page.goto("/app/cards");
  await setAllowance(page, "100");

  await controls(page).getByRole("button", { name: "Freeze card" }).click();
  await expect(toast(page, "Card frozen")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: /^Aura card ending/ })).toContainText("Frozen");
  expect(await edge("/__stripe/authorize", { amount: "5" })).toMatchObject({ approved: false });

  // Cancelling the passkey prompt leaves it frozen.
  await page.evaluate(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  await controls(page).getByRole("button", { name: "Unfreeze card" }).click();
  await expect(toast(page, "Card not changed")).toBeVisible({ timeout: 20_000 });
  await expect(controls(page).getByText("Card is frozen")).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("aura-e2e-passkey"));
  await controls(page).getByRole("button", { name: "Unfreeze card" }).click();
  await expect(toast(page, "Card unfrozen")).toBeVisible({ timeout: 20_000 });
  expect(await edge("/__stripe/authorize", { amount: "5" })).toMatchObject({ approved: true });

  // Lowering the limit applies at once; raising it asks for the passkey.
  await controls(page).getByLabel("Daily limit in USD").fill("20");
  await controls(page).getByRole("button", { name: "Save" }).click();
  await expect(toast(page, "Daily limit updated")).toBeVisible({ timeout: 20_000 });
  expect(await edge("/__stripe/authorize", { amount: "30" })).toMatchObject({ approved: false });
  await controls(page).getByLabel("Daily limit in USD").fill("800");
  await controls(page).getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Daily limit $800.00.")).toBeVisible({ timeout: 20_000 });

  // Locking the account in Settings freezes the card, and it stays frozen while locked.
  await setControls(page, customer, { accountLocked: true });
  await page.reload();
  await expect(controls(page).getByText("Card is frozen")).toBeVisible({ timeout: 20_000 });
  await controls(page).getByRole("button", { name: "Unfreeze card" }).click();
  await expect(page.locator(".toastRegion")).toContainText("Your account is locked", { timeout: 20_000 });
});

test("card details show in Stripe's frame after a passkey check", async ({ page }) => {
  await withCard(page);
  await page.goto("/app/cards");
  await page.getByRole("button", { name: "Show card details" }).click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await page.evaluate(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  await dialog.getByRole("button", { name: "Confirm with your passkey" }).click();
  await expect(toast(page, "Card details not shown")).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByTestId("card-secure-details")).not.toContainText("4000");

  await page.evaluate(() => localStorage.removeItem("aura-e2e-passkey"));
  await dialog.getByRole("button", { name: "Confirm with your passkey" }).click();
  await expect(dialog.getByTestId("card-secure-details")).toContainText(/4000 0000 0000 \d{4}/, { timeout: 20_000 });
  await expect(dialog.getByTestId("card-secure-details")).toContainText("09/29");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("with phone wallets on, the card can be added to Apple Pay or Google Pay", async ({ page }) => {
  await withCard(page);
  await page.goto("/app/cards");
  await expect(controls(page)).toBeVisible({ timeout: 20_000 });
  await expect(controls(page).getByText("Apple Pay and Google Pay")).toHaveCount(0);
  await setFeature(page, "card_wallets", true);
  await page.reload();
  await controls(page).getByRole("button", { name: "Add to phone" }).click();
  await expect(controls(page).getByRole("button", { name: "Add to Apple Wallet" })).toBeVisible({ timeout: 20_000 });
  await expect(controls(page).getByRole("button", { name: "Add to Google Pay" })).toBeVisible();
});

test("when Stripe can't read the card, the page says so and Freeze still works", async ({ page }) => {
  await withCard(page);
  await edge("/__state", { down: ["stripe:card-read"] });
  await page.goto("/app/cards");
  await expect(page.getByRole("heading", { name: "Your card is unavailable right now" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: /^Aura card ending \d{4}$/ })).toContainText("Unavailable");
  await page.getByRole("button", { name: "Freeze card" }).click();
  await expect(toast(page, "Card frozen")).toBeVisible({ timeout: 20_000 });
  const { cards } = await edge("/__stripe/state") as unknown as { cards: Record<string, { status: string }> };
  expect(Object.values(cards).map((card) => card.status)).toEqual(["inactive"]);
  await edge("/__state", { down: [] });
});

test("a lost card is replaced with a new number after a passkey check; the old one stops working", async ({ page }) => {
  test.setTimeout(120_000);
  await withCard(page);
  await page.goto("/app/cards");
  const old = page.getByRole("region", { name: /^Aura card ending \d{4}$/ });
  const oldName = await old.getAttribute("aria-label", { timeout: 20_000 });
  await controls(page).getByRole("button", { name: "Replace" }).click();
  await controls(page).getByRole("radio", { name: "Lost" }).click();
  // Cancelling the passkey prompt keeps the card.
  await page.evaluate(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  await controls(page).getByRole("button", { name: "Cancel card and get a new one" }).click();
  await expect(toast(page, "Card not replaced")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => localStorage.removeItem("aura-e2e-passkey"));
  await controls(page).getByRole("button", { name: "Cancel card and get a new one" }).click();
  await expect(toast(page, "Your new card is ready")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: /^Aura card ending \d{4}$/ })).not.toHaveAttribute("aria-label", oldName!);
  const { cards } = await edge("/__stripe/state") as unknown as { cards: Record<string, { status: string }> };
  expect(Object.values(cards).map((card) => card.status)).toEqual(["canceled", "active"]);
});
