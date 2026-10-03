import type { Page } from "@playwright/test";
import { expect, outcome, test } from "./support/fixtures";
import { LIFI_DIAMOND } from "./support/fake-edge.mjs";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer, setControls, pauseAsset } from "./support/session";

// Feature 3 in docs/overview/feature-readiness.md: sending from the Aura
// account on Base. The passkey prompt, Privy's sponsored relay, and the chain
// are the local fake; Aura's pages, API routes, controls, verifier, and D1
// run for real. The relayed operation is a real EntryPoint handleOps with a
// Kernel batch, so the verifier checks it exactly as on Base.

const RECIPIENT = "0x5555555555555555555555555555555555555555";
const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
// Send is a page (journey J5): the crypto form is the "Send crypto" region.
const dialog = (page: Page) => page.getByRole("region", { name: "Send crypto" });
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
  if (input.asset) await dialog(page).getByLabel("Asset").selectOption(input.asset);
  await dialog(page).getByLabel("Amount").fill(input.amount);
  if (input.to !== undefined) await dialog(page).getByLabel("To").fill(input.to);
}

const addressCheck = (page: Page) => dialog(page).getByRole("region", { name: "You haven't sent to this address before" });

/** Review. An address never used from this account is checked first (B2); these tests confirm it and go on. */
async function reviewSend(page: Page) {
  await dialog(page).getByRole("button", { name: "Review" }).click();
  await addressCheck(page).getByRole("button", { name: "It's correct" }).click({ timeout: 3_000 }).catch(() => undefined);
}

async function reviewAndConfirm(page: Page) {
  await reviewSend(page);
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "direct_transfers", true);
  await setFeature(page, "cross_chain", false);
});

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app/send", "/api/overview", "/api/recipients"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("a first-time address is checked in chunks before the review; once used, it isn't (B2)", async ({ page }) => {
  await openSend(page);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await dialog(page).getByRole("button", { name: "Review" }).click();
  await expect(addressCheck(page).getByTestId("address-chunks")).toHaveText("0x5555 5555 5555 5555 55555555 5555 5555 5555 5555");
  await expect(addressCheck(page)).toContainText("Base");
  await expect(addressCheck(page)).toContainText("send a small test first");
  await expect(page.getByTestId("send-review")).toHaveCount(0);
  expect(await relayed()).toEqual([]);
  // Edit goes back with everything kept; the check comes again.
  await addressCheck(page).getByRole("button", { name: "Edit" }).click();
  await expect(dialog(page).getByLabel("To")).toHaveValue(RECIPIENT);
  await dialog(page).getByRole("button", { name: "Review" }).click();
  await addressCheck(page).getByRole("button", { name: "It's correct" }).click();
  await expect(page.getByTestId("send-review").locator(`[title="${RECIPIENT}"]`)).toHaveCount(1);
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });

  // Sent to once, it's no longer new: the next transfer goes straight to the review.
  await dialog(page).getByRole("button", { name: "New transfer" }).click();
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await expect(dialog(page).getByRole("list", { name: "Send steps" })).not.toContainText("Check", { timeout: 20_000 });
  await dialog(page).getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("send-review").locator(`[title="${RECIPIENT}"]`)).toHaveCount(1);
  await expect(addressCheck(page)).toHaveCount(0);
});

test("USDC goes to an address after a review, with the fee paid by Aura, and the chain confirms it", async ({ page }) => {
  const customer = await openSend(page);
  await fillSend(page, { amount: "12.5", to: RECIPIENT });
  await reviewSend(page);

  const review = page.getByTestId("send-review");
  await expect(review).toContainText("12.5 USDC");
  await expect(review.locator(`[title="${RECIPIENT}"]`)).toHaveCount(1);
  await expect(review).toContainText("Base");
  await expect(review).toContainText("Paid by Aura");
  expect(await relayed()).toEqual([]);

  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  const [operation] = await relayed();
  expect(operation).toMatchObject({ from: customer.wallet.toLowerCase(), success: true });
  expect(operation.calls).toHaveLength(1);
  expect(operation.calls![0].to.toLowerCase()).toBe(ASSETS.usdc);
  expect(await balance(page, customer, `8453:${ASSETS.usdc}`)).toBe("37500000");
});

test("a matched transfer is complete once in a block, before Base makes it final", async ({ page }) => {
  await edge("/__state", { finalizeAll: false });
  await openSend(page);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  await expect(dialog(page).getByText("Transfer complete")).toBeVisible();
  await expect(dialog(page).getByText("Base makes it final in about 20 minutes.")).toBeVisible();
});

test("ETH and cbBTC can be sent too", async ({ page }) => {
  const customer = await openSend(page, { balances: { native: "1000000000000000000", [ASSETS.cbbtc]: "100000000" } });
  await fillSend(page, { asset: "cbBTC", amount: "0.25", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  expect(await balance(page, customer, `8453:${ASSETS.cbbtc}`)).toBe("75000000");

  await dialog(page).getByRole("button", { name: "New transfer" }).click();
  await dialog(page).getByLabel("Asset").selectOption("ETH");
  await dialog(page).getByLabel("Amount").fill("0.1");
  await dialog(page).getByLabel("To").fill(RECIPIENT);
  await reviewAndConfirm(page);
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => balance(page, customer, "8453:native")).toBe("900000000000000000");
});

test("Max fills the whole balance, and more than the balance is refused before review", async ({ page }) => {
  await openSend(page);
  await fillSend(page, { amount: "60", to: RECIPIENT });
  await expect(dialog(page).getByText("50 USDC available")).toBeVisible({ timeout: 20_000 });
  await reviewSend(page);
  await expect(dialog(page).getByText("That's more USDC than you have.")).toBeVisible();
  await dialog(page).getByRole("button", { name: "Max" }).click();
  await expect(dialog(page).getByLabel("Amount")).toHaveValue("50");
});

test("bad input is caught before anything is prepared", async ({ page }) => {
  const customer = await openSend(page);
  const check = async (amount: string, to: string, message: string) => {
    await dialog(page).getByLabel("Amount").fill(amount);
    await dialog(page).getByLabel("To").fill(to);
    await reviewSend(page);
    await expect(dialog(page).getByText(message)).toBeVisible();
  };
  await fillSend(page, { amount: "1" });
  await check("1", "0x123", "Enter a valid address or Aura tag.");
  await check("1", customer.wallet, "This is your own Aura address.");
  await check("0", RECIPIENT, "Enter an amount greater than zero.");
  await check("1.1234567", RECIPIENT, "Use at most 6 decimal places.");
  expect(await relayed()).toEqual([]);
});

test("the server refuses a token contract as the recipient", async ({ page }) => {
  await openSend(page);
  await fillSend(page, { amount: "1", to: ASSETS.usdc });
  await reviewAndConfirm(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Transfer not sent", { timeout: 20_000 });
  await expect(dialog(page).getByRole("alert")).toContainText("token contract");
  expect(await relayed()).toEqual([]);
});

test("the customer can send to their own connected wallet in one tap", async ({ page }) => {
  const customer = await openSend(page, { connectedWallet: true });
  const own = customer.externalWallets[0];
  await fillSend(page, { amount: "2" });
  await dialog(page).getByRole("group", { name: "Recipients" }).getByRole("button", { name: `My wallet ${own.slice(0, 6)}…${own.slice(-4)}` }).click();
  await expect(page.getByTestId("recipient-status")).toHaveText("Your wallet");
  await reviewSend(page);
  await expect(page.getByTestId("send-review")).toContainText("Your wallet");
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
});

test("a saved recipient can be picked by name", async ({ page }) => {
  const customer = await openSend(page);
  await setControls(page, customer, { newAddressDelayHours: 0 });
  await asCustomer(page, customer, "POST", "/api/security/addresses", { address: RECIPIENT, label: "Sam" });
  await page.reload();
  await fillSend(page, { amount: "3" });
  await dialog(page).getByRole("group", { name: "Recipients" }).getByRole("button", { name: /^Sam/ }).click();
  await expect(dialog(page).getByLabel("To")).toHaveValue(RECIPIENT);
  await expect(page.getByTestId("recipient-status")).toHaveText("Saved recipient: Sam");
  await expect(dialog(page).getByLabel("Save as a recipient")).toHaveCount(0);
  await reviewSend(page);
  await expect(page.getByTestId("send-review")).toContainText("Sam");
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
});

test("an Aura tag is found, checked again before signing, and shown in the review", async ({ page }) => {
  const payee = await newCustomer();
  const tag = `sam${payee.wallet.slice(2, 10).toLowerCase()}`;
  await acceptTerms(page, payee);
  await asCustomer(page, payee, "PUT", "/api/aura-tags", { tag, address: payee.wallet, displayName: "Sam", publicEnabled: true });
  await openSend(page);
  // The To field takes an Aura tag as well as an address; Aura finds the tag on Review.
  await dialog(page).getByLabel("To").fill(`@${tag}`);
  await dialog(page).getByLabel("Amount").fill("4");
  await reviewSend(page);
  await expect(page.getByTestId("send-review")).toContainText(`${payee.wallet.slice(0, 6)}…${payee.wallet.slice(-4)}`);
  await expect(page.getByTestId("send-review")).toContainText(`@${tag}`);
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  expect(await balance(page, payee, `8453:${ASSETS.usdc}`)).toBe("4000000");
});

test("an unknown Aura tag isn't found", async ({ page }) => {
  await openSend(page);
  await fillSend(page, { amount: "1", to: "@nobody-here" });
  await reviewSend(page);
  await expect(dialog(page).getByText("We couldn't find @nobody-here.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("send-review")).toHaveCount(0);
});

test("the customer's controls are enforced on the server: daily limit, saved recipients only, waiting period, and lock", async ({ page }) => {
  // Four full attempts, each with a reload.
  test.setTimeout(60_000);
  const customer = await openSend(page);
  const attempt = async (message: string) => {
    await fillSend(page, { amount: "12.5", to: RECIPIENT });
    await reviewAndConfirm(page);
    await expect(dialog(page).getByRole("alert")).toContainText(message, { timeout: 20_000 });
    await page.keyboard.press("Escape");
    await page.reload();
  };
  await setControls(page, customer, { dailyLimitUsd: 10 });
  await attempt("This would go over your daily limit.");
  await setControls(page, customer, { dailyLimitUsd: null, enforceAddressBook: true });
  await attempt("Your settings only allow sending to saved recipients.");
  await asCustomer(page, customer, "POST", "/api/security/addresses", { address: RECIPIENT, label: "Sam" });
  await attempt("This saved recipient is still in its waiting period.");
  await setControls(page, customer, { enforceAddressBook: false, accountLocked: true });
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
  await expect(dialog(page).getByRole("alert")).toContainText("You cancelled. Nothing was sent.", { timeout: 20_000 });
  expect(await relayed()).toEqual([]);
});

test("while sending is switched off, the customer is told up front, and the server refuses a send already on screen", async ({ page }) => {
  await openSend(page);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  // Switched off after the page loaded: the server still refuses it.
  await setFeature(page, "direct_transfers", false);
  await reviewAndConfirm(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Transfer not sent", { timeout: 20_000 });
  await expect(dialog(page).getByRole("alert")).toContainText("temporarily unavailable");
  // Loaded while it's off: the page says so before anything is filled in, and Review is off.
  await page.reload();
  await expect(page.getByTestId("sending-off")).toHaveText("Sending is paused right now. Try again later.", { timeout: 30_000 });
  await expect(dialog(page).getByRole("button", { name: "Review" })).toBeDisabled();
  expect(await relayed()).toEqual([]);
});

test("a paused asset can't be sent", async ({ page }) => {
  await openSend(page);
  await pauseAsset(page, `8453:${ASSETS.usdc}`, true);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(dialog(page).getByRole("alert")).toContainText("USDC is paused right now", { timeout: 20_000 });
  await pauseAsset(page, `8453:${ASSETS.usdc}`, false);
  expect(await relayed()).toEqual([]);
});

test("when Privy refuses the request, nothing is sent", async ({ page }) => {
  await edge("/__state", { relay: "reject" });
  await openSend(page);
  await fillSend(page, { amount: "1", to: RECIPIENT });
  await reviewAndConfirm(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Nothing was sent", { timeout: 20_000 });
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
  await expect(outcome(page, "Transfer failed")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".transactionProgress")).toContainText("The network rejected it. Nothing moved.");
  expect(await balance(page, customer, `8453:${ASSETS.usdc}`)).toBe("50000000");
});

test("bank transfers are shown as coming soon", async ({ page }) => {
  await openSend(page);
  await page.getByRole("tab", { name: /To a bank account/ }).click();
  const bank = page.getByRole("region", { name: "Send to a bank" });
  await expect(bank.getByText("Coming soon", { exact: true })).toBeVisible();
});

test("a new address can be saved as a recipient, with a name, as it's sent to", async ({ page }) => {
  await openSend(page);
  await fillSend(page, { amount: "2", to: RECIPIENT });
  await expect(page.getByTestId("recipient-status")).toHaveText("New address. Check it carefully.");
  await dialog(page).getByLabel("Save as a recipient").check();
  await reviewSend(page);
  await expect(dialog(page).getByRole("alert")).toHaveText("Give this recipient a name.");
  await dialog(page).getByLabel("Name").fill("Alex");
  await reviewSend(page);
  await expect(page.getByTestId("send-review")).toContainText("Save asAlex");
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect(toast(page, "Recipient saved")).toBeVisible({ timeout: 20_000 });
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  // The security notice goes to the bell (and email), but this browser isn't toasted about what the customer just did.
  const inbox = page.waitForResponse((response) => response.url().endsWith("/api/notifications") && response.ok());
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  expect(JSON.stringify(await (await inbox).json())).toContain("New saved recipient");
  await expect(toast(page, "New saved recipient")).toHaveCount(0);

  // Next time it's one tap. New recipients start with the waiting period, which only matters with saved-recipients-only on.
  await dialog(page).getByRole("button", { name: "New transfer" }).click();
  await fillSend(page, { amount: "1" });
  await dialog(page).getByRole("group", { name: "Recipients" }).getByRole("button", { name: /^Alex/ }).click();
  await expect(page.getByTestId("recipient-status")).toContainText("Saved recipient: Alex. In its waiting period until");
});

test("USDC can be sent to another network: LI.FI's fees come out of the amount, and delivery is checked there", async ({ page }) => {
  await setFeature(page, "cross_chain", true);
  const customer = await openSend(page);
  await fillSend(page, { amount: "10", to: RECIPIENT });
  await expect(dialog(page).getByLabel("Network").locator("option")).toHaveText(["Base", "Ethereum", "Arbitrum", "Optimism", "Polygon"]);
  await dialog(page).getByLabel("Network").selectOption("Arbitrum");
  await expect(dialog(page)).toContainText("a small fee, taken from the amount");
  await reviewSend(page);

  const review = page.getByTestId("send-review");
  await expect(review).toContainText("10 USDC");
  await expect(review).toContainText("NetworkArbitrum");
  await expect(review).toContainText("They receiveAbout 9.95 USDC");
  await expect(review).toContainText("At least9.9 USDC");
  await expect(review).toContainText("About $0.50, taken from the amount");
  await expect(review).toContainText("Network feePaid by Aura");
  expect(await relayed()).toEqual([]);

  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect.poll(async () => (await relayed()).length, { timeout: 30_000 }).toBe(1);
  const [operation] = await relayed();
  expect(operation.calls!.map((call) => call.to.toLowerCase())).toEqual([ASSETS.usdc, LIFI_DIAMOND]);
  expect(await balance(page, customer, `8453:${ASSETS.usdc}`)).toBe("40000000");

  // Once it has left Base, the Send screen is done with it: sent, no spinner, and a way to track it.
  const progress = dialog(page).getByRole("status");
  await expect(progress).toContainText("Transfer sent", { timeout: 30_000 });
  await expect(progress).toContainText("on its way to Arbitrum");
  await expect(progress.locator(".spin")).toHaveCount(0);
  await expect(dialog(page).getByRole("button", { name: "New transfer" })).toBeEnabled();
  await expect(outcome(page, "Transfer complete")).toHaveCount(0);

  // Transactions shows the journey, with only the current step in progress, and completes once the payout is on Arbitrum.
  await progress.getByRole("link", { name: "Track in Transactions" }).click();
  await expect(page).toHaveURL(/\/app\/transactions\?open=/);
  const journey = page.getByRole("dialog").getByRole("list", { name: "Progress" });
  await expect(journey.getByRole("listitem")).toHaveText([/^Sent from Base/, /^Confirmed on Base/, /^Delivered on ArbitrumIn progress/, /^Complete$/], { timeout: 30_000 });
  await expect(journey.locator(".spin")).toHaveCount(1);
  await edge("/__state", { bridge: { status: "DONE", substatus: "COMPLETED" } });
  await expect(journey.locator("li.done")).toHaveCount(4, { timeout: 45_000 });
  await expect(journey.locator(".spin")).toHaveCount(0);
  await setFeature(page, "cross_chain", false);
});

test("ETH sent to someone on another network completes only once the ETH is seen arriving there", async ({ page }) => {
  await setFeature(page, "cross_chain", true);
  await openSend(page, { balances: { native: "1000000000000000000" } });
  await fillSend(page, { asset: "ETH", amount: "0.1", to: RECIPIENT });
  await dialog(page).getByLabel("Network").selectOption("Arbitrum");
  await reviewAndConfirm(page);
  await expect.poll(async () => (await relayed()).length, { timeout: 30_000 }).toBe(1);
  const progress = dialog(page).getByRole("status");
  await expect(progress).toContainText("on its way to Arbitrum", { timeout: 30_000 });

  // ETH leaves no token log; the verifier reads the recipient's ETH on Arbitrum across the payout's block.
  await progress.getByRole("link", { name: "Track in Transactions" }).click();
  const journey = page.getByRole("dialog").getByRole("list", { name: "Progress" });
  await expect(journey.getByRole("listitem")).toHaveText([/^Sent from Base/, /^Confirmed on Base/, /^Delivered on ArbitrumIn progress/, /^Complete$/], { timeout: 30_000 });
  await edge("/__state", { bridge: { status: "DONE", substatus: "COMPLETED" } });
  await expect(journey.locator("li.done")).toHaveCount(4, { timeout: 45_000 });
  await setFeature(page, "cross_chain", false);
});

test("sending to another network needs both the send and cross-network switches, and only offers networks where the asset is registered", async ({ page }) => {
  await openSend(page, { balances: { [ASSETS.usdc]: "50000000", [ASSETS.weth]: "1000000000000000000" } });
  await fillSend(page, { asset: "WETH", amount: "0.1", to: RECIPIENT });
  await expect(dialog(page).getByLabel("Network").locator("option")).toHaveText(["Base"]);
  // With other networks off, USDC is offered on Base only, and the page says why.
  await dialog(page).getByLabel("Asset").selectOption("USDC");
  await expect(dialog(page).getByLabel("Network").locator("option")).toHaveText(["Base"]);
  await expect(page.getByTestId("other-networks-off")).toContainText("Sending to other networks is paused right now.");

  // Switched off after the page offered Polygon: the server refuses the quote.
  await setFeature(page, "cross_chain", true);
  await page.reload();
  await fillSend(page, { asset: "USDC", amount: "0.1", to: RECIPIENT });
  await dialog(page).getByLabel("Network").selectOption("Polygon");
  await setFeature(page, "cross_chain", false);
  await reviewSend(page);
  await expect(dialog(page).getByRole("alert")).toContainText("Sending to other networks isn't available right now.", { timeout: 20_000 });
  await expect(page.getByTestId("send-review")).toHaveCount(0);

  await setFeature(page, "cross_chain", true);
  await setFeature(page, "direct_transfers", false);
  await reviewSend(page);
  await expect(dialog(page).getByRole("alert")).toContainText("isn't available right now", { timeout: 20_000 });
  await expect(page.getByTestId("send-review")).toHaveCount(0);
  await setFeature(page, "cross_chain", false);
  expect(await relayed()).toEqual([]);
});

test("a token contract is refused as the recipient on another network too", async ({ page }) => {
  await setFeature(page, "cross_chain", true);
  await openSend(page);
  await fillSend(page, { amount: "1", to: ASSETS.usdc });
  await dialog(page).getByLabel("Network").selectOption("Optimism");
  await reviewSend(page);
  await expect(dialog(page).getByRole("alert")).toContainText("token contract", { timeout: 20_000 });
  await setFeature(page, "cross_chain", false);
});

test("a tokenized stock can be sent on Base, and Tether Gold on Ethereum, where it's held", async ({ page }) => {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "1000000", [ASSETS.apple]: "300000000" }, 1: { [ASSETS.xaut]: "1000000" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  await page.goto("/app/send");
  await expect(page.getByRole("heading", { name: "Send crypto" })).toBeVisible({ timeout: 30_000 });

  await fillSend(page, { asset: "AAPLc", amount: "1.25", to: RECIPIENT });
  await expect(dialog(page).getByLabel("Network").locator("option")).toHaveText(["Base"]);
  await reviewAndConfirm(page);
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
  expect(await balance(page, customer, `8453:${ASSETS.apple}`)).toBe("175000000");
  await dialog(page).getByRole("button", { name: "New transfer" }).click();

  await fillSend(page, { asset: "XAUt", amount: "0.25", to: RECIPIENT });
  await expect(dialog(page).getByLabel("Network").locator("option")).toHaveText(["Ethereum"]);
  await expect(dialog(page)).toContainText("1 XAUt available");
  await reviewSend(page);
  await expect(page.getByTestId("send-review")).toContainText("NetworkEthereum");
  await expect(page.getByTestId("send-review")).toContainText("Network feePaid by Aura");
  await dialog(page).getByRole("button", { name: "Confirm and send" }).click();
  await expect.poll(async () => (await relayed()).find((item) => item.chainId === 1)?.success, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => balance(page, customer, `1:${ASSETS.xaut}`), { timeout: 30_000 }).toBe("750000");
});
