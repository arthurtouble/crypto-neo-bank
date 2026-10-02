import type { Page } from "@playwright/test";
import { assetsFor } from "../../src/lib/assets/registry";
import { expect, test } from "./support/fixtures";
import { acceptTerms, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer } from "./support/session";

// Feature 2 in docs/overview/feature-readiness.md: every way to add money.
// The connected wallet (a fake MetaMask), the chains, LI.FI, and Privy's card
// flow are the local fake; Aura's pages, API routes, and D1 run for real.

const ARBITRUM_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const LIFI_DIAMOND = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";

type Way = "Receive" | "From a wallet" | "Card" | "Bank";
const showWay = (page: Page, way: Way) => page.getByRole("tab", { name: way }).click();

/** Opens Deposit on Receive, then on another way if one is named (tabs on desktop, rows on the phone). */
async function openDeposit(page: Page, customer: Customer, way?: Way) {
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  await page.goto("/app/deposit");
  await expect(page.getByRole("heading", { name: "Receive", exact: true })).toBeVisible({ timeout: 30_000 });
  if (way) await showWay(page, way);
}

const wallet = (page: Page) => page.getByRole("region", { name: "From your wallet" });
const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
const sent = async () => (await edge("/__sent")).sent!;

async function balanceOf(page: Page, customer: Customer, id: string) {
  const response = await page.request.get("/api/overview", { headers: { Authorization: `Bearer ${customer.token}`, Connection: "close" } });
  const overview = await response.json() as { holdings: Array<{ id: string; amountRaw: string | null }> };
  return overview.holdings.find((item) => item.id === id)?.amountRaw ?? "0";
}

test.beforeEach(async () => { await edge("/__reset"); });

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  await request.get("/app/deposit", { timeout: 120_000 });
  await request.get("/api/money/account", { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("the Deposit page shows all four ways to add money", async ({ page }) => {
  const customer = await newCustomer();
  await openDeposit(page, customer);

  await expect(page.getByTestId("account-address")).toHaveText(customer.wallet);
  await expect(page.getByRole("img", { name: "QR code of your Aura account address" })).toBeVisible();
  await expect(page.getByText(/Only send USDC on the Base network/)).toBeVisible();
  // Receive names every asset that shows in Aura when it arrives on Base, straight from the registry (B3).
  const receivable = page.getByLabel("What you're sending").locator("option");
  await expect(receivable).toHaveCount(assetsFor("hold", 8453).length);
  for (const symbol of ["USDC", "ETH", "cbBTC", "EURC"]) await expect(receivable.filter({ hasText: symbol }).first()).toBeAttached();
  await expect(receivable.filter({ hasText: "XAUt" })).toHaveCount(0);
  await showWay(page, "From a wallet");
  await expect(page.getByRole("heading", { name: "From your wallet" })).toBeVisible();
  await showWay(page, "Card");
  await expect(page.getByRole("button", { name: "Pay by card" })).toBeVisible();
  await showWay(page, "Bank");
  const bank = page.getByRole("region", { name: "Deposit from a bank" });
  await expect(bank.getByText("Coming soon", { exact: true })).toBeVisible();
  await expect(bank.getByText(/deposits will arrive as USDC/)).toBeVisible();
});

test("the customer copies their account address", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const customer = await newCustomer();
  await openDeposit(page, customer);
  await page.getByRole("button", { name: "Copy address" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(customer.wallet);
});

test("without a connected wallet, the customer is asked to connect one", async ({ page }) => {
  const customer = await newCustomer();
  await openDeposit(page, customer, "From a wallet");
  await expect(wallet(page).getByRole("button", { name: "Connect a wallet" })).toBeVisible();
});

test("USDC on Base moves from the connected wallet into the account", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  const [source] = customer.externalWallets;
  await setBalances(source, { 8453: { [ASSETS.usdc]: "100000000" } });
  await openDeposit(page, customer, "From a wallet");

  await expect(wallet(page).getByText(/100 USDC available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByRole("button", { name: "Max" }).click();
  await expect(wallet(page).getByLabel("Amount in USDC")).toHaveValue("100");
  await wallet(page).getByLabel("Amount in USDC").fill("25");
  await wallet(page).getByRole("button", { name: "Add from wallet" }).click();

  await expect(toast(page, "Added")).toBeVisible({ timeout: 30_000 });
  const [transfer] = await sent();
  expect(transfer).toMatchObject({ chainId: 8453, from: source.toLowerCase(), to: ASSETS.usdc, success: true });
  expect(await balanceOf(page, customer, `8453:${ASSETS.usdc}`)).toBe("25000000");
});

test("ETH on Base moves as a plain transfer", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  const [source] = customer.externalWallets;
  await setBalances(source, { 8453: { native: "1000000000000000000" } });
  await openDeposit(page, customer, "From a wallet");

  await wallet(page).getByLabel("Asset").selectOption("ETH");
  await expect(wallet(page).getByText(/1 ETH available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByLabel("Amount in ETH").fill("0.25");
  await wallet(page).getByRole("button", { name: "Add from wallet" }).click();

  await expect(toast(page, "Added")).toBeVisible({ timeout: 30_000 });
  const [transfer] = await sent();
  expect(transfer).toMatchObject({ chainId: 8453, to: customer.wallet.toLowerCase(), value: "250000000000000000", data: "0x" });
});

test("amounts are checked before anything is sent", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  await setBalances(customer.externalWallets[0], { 8453: { [ASSETS.usdc]: "10000000" } });
  await openDeposit(page, customer, "From a wallet");
  await expect(wallet(page).getByText(/10 USDC available/)).toBeVisible({ timeout: 20_000 });

  const amount = wallet(page).getByLabel("Amount in USDC");
  const submit = wallet(page).getByRole("button", { name: "Add from wallet" });
  await amount.fill("abc"); await submit.click();
  await expect(wallet(page).getByText("Enter an amount like 25 or 0.05.")).toBeVisible();
  await amount.fill("0"); await submit.click();
  await expect(wallet(page).getByText("Enter an amount greater than zero.")).toBeVisible();
  await amount.fill("11"); await submit.click();
  await expect(wallet(page).getByText("That's more USDC on Base than this wallet holds.")).toBeVisible();
  expect(await sent()).toEqual([]);
});

test("cancelling in the wallet sends nothing", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  await setBalances(customer.externalWallets[0], { 8453: { [ASSETS.usdc]: "10000000" } });
  await page.addInitScript(() => localStorage.setItem("aura-e2e-wallet", "reject"));
  await openDeposit(page, customer, "From a wallet");
  await expect(wallet(page).getByText(/10 USDC available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByLabel("Amount in USDC").fill("5");
  await wallet(page).getByRole("button", { name: "Add from wallet" }).click();
  await expect(toast(page, "Cancelled")).toBeVisible();
  expect(await sent()).toEqual([]);
});

test("a transfer the network rejects is reported, and nothing arrives", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  await setBalances(customer.externalWallets[0], { 8453: { [ASSETS.usdc]: "10000000" } });
  await edge("/__state", { revertNext: true });
  await openDeposit(page, customer, "From a wallet");
  await expect(wallet(page).getByText(/10 USDC available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByLabel("Amount in USDC").fill("5");
  await wallet(page).getByRole("button", { name: "Add from wallet" }).click();
  await expect(toast(page, "Deposit didn't go through")).toBeVisible({ timeout: 30_000 });
  expect(await balanceOf(page, customer, `8453:${ASSETS.usdc}`)).toBe("0");
});

test("USDC from Arbitrum is bridged to USDC on Base, with fees shown first", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  const [source] = customer.externalWallets;
  await setBalances(source, { 42161: { [ARBITRUM_USDC]: "100000000" } });
  await setFeature(page, "cross_chain", true);
  await openDeposit(page, customer, "From a wallet");

  await wallet(page).getByLabel("Network").selectOption("Arbitrum");
  await expect(wallet(page).getByText(/100 USDC available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByLabel("Amount in USDC").fill("40");
  await wallet(page).getByRole("button", { name: "Review" }).click();

  const review = wallet(page).locator(".mxSummary");
  await expect(review).toContainText("39.8 USDC", { timeout: 20_000 });
  await expect(review).toContainText("39.6 USDC");
  await expect(review).toContainText("$0.50");
  await expect(review).toContainText("$0.10");
  await wallet(page).getByRole("button", { name: "Confirm deposit" }).click();

  await expect(toast(page, "Sent")).toBeVisible({ timeout: 30_000 });
  await expect(wallet(page).getByRole("button", { name: "On its way" })).toBeVisible();
  const [approve, bridge] = await sent();
  expect(approve).toMatchObject({ chainId: 42161, to: ARBITRUM_USDC, success: true });
  expect(bridge).toMatchObject({ chainId: 42161, to: LIFI_DIAMOND, value: "0", success: true });

  // LI.FI reports delivery; the page follows it and says so.
  await edge("/__state", { bridge: { status: "DONE", substatus: "COMPLETED" } });
  await expect(toast(page, "Added")).toBeVisible({ timeout: 30_000 });
  await setFeature(page, "cross_chain", false);
});

test("ETH from Ethereum is bridged in one transaction", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  await setBalances(customer.externalWallets[0], { 1: { native: "2000000000000000000" } });
  await setFeature(page, "cross_chain", true);
  await openDeposit(page, customer, "From a wallet");

  await wallet(page).getByLabel("Network").selectOption("Ethereum");
  await wallet(page).getByLabel("Asset").selectOption("ETH");
  await expect(wallet(page).getByText(/2 ETH available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByLabel("Amount in ETH").fill("1");
  await wallet(page).getByRole("button", { name: "Review" }).click();
  await expect(wallet(page).locator(".mxSummary")).toContainText("0.995 ETH", { timeout: 20_000 });
  await wallet(page).getByRole("button", { name: "Confirm deposit" }).click();
  await expect(toast(page, "Sent")).toBeVisible({ timeout: 30_000 });
  const transactions = await sent();
  expect(transactions).toHaveLength(1);
  expect(transactions[0]).toMatchObject({ chainId: 1, to: LIFI_DIAMOND, value: "1000000000000000000" });
  await setFeature(page, "cross_chain", false);
});

test("a refunded bridge tells the customer the funds went back to their wallet", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  await setBalances(customer.externalWallets[0], { 42161: { [ARBITRUM_USDC]: "100000000" } });
  await setFeature(page, "cross_chain", true);
  await openDeposit(page, customer, "From a wallet");
  await wallet(page).getByLabel("Network").selectOption("Arbitrum");
  await expect(wallet(page).getByText(/100 USDC available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByLabel("Amount in USDC").fill("10");
  await wallet(page).getByRole("button", { name: "Review" }).click();
  await wallet(page).getByRole("button", { name: "Confirm deposit" }).click();
  await expect(toast(page, "Sent")).toBeVisible({ timeout: 30_000 });
  await edge("/__state", { bridge: { status: "DONE", substatus: "REFUNDED" } });
  await expect(toast(page, "Deposit didn't complete")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".toastRegion")).toContainText("sent the funds back to your wallet");
  await setFeature(page, "cross_chain", false);
});

test("while deposits from other networks are switched off, the customer is told and can still use Base", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  await setBalances(customer.externalWallets[0], { 42161: { [ARBITRUM_USDC]: "100000000" } });
  await setFeature(page, "cross_chain", false);
  await openDeposit(page, customer, "From a wallet");
  await wallet(page).getByLabel("Network").selectOption("Arbitrum");
  await expect(wallet(page).getByText(/100 USDC available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByLabel("Amount in USDC").fill("10");
  await wallet(page).getByRole("button", { name: "Review" }).click();
  await expect(toast(page, "Not available right now")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".toastRegion")).toContainText("aren't available right now");
  expect(await sent()).toEqual([]);
});

test("when the bridge provider is down, no route is offered and nothing is sent", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  await setBalances(customer.externalWallets[0], { 42161: { [ARBITRUM_USDC]: "100000000" } });
  await setFeature(page, "cross_chain", true);
  await edge("/__state", { down: ["lifi"] });
  await openDeposit(page, customer, "From a wallet");
  await wallet(page).getByLabel("Network").selectOption("Arbitrum");
  await expect(wallet(page).getByText(/100 USDC available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByLabel("Amount in USDC").fill("10");
  await wallet(page).getByRole("button", { name: "Review" }).click();
  await expect(toast(page, "Not available right now")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".toastRegion")).toContainText("We can't get a price right now");
  expect(await sent()).toEqual([]);
  await setFeature(page, "cross_chain", false);
});

test("an expired price must be reviewed again before anything is sent", async ({ page }) => {
  const customer = await newCustomer({ connectedWallet: true });
  await setBalances(customer.externalWallets[0], { 42161: { [ARBITRUM_USDC]: "100000000" } });
  await setFeature(page, "cross_chain", true);
  await page.clock.install();
  await openDeposit(page, customer, "From a wallet");
  await wallet(page).getByLabel("Network").selectOption("Arbitrum");
  await expect(wallet(page).getByText(/100 USDC available/)).toBeVisible({ timeout: 20_000 });
  await wallet(page).getByLabel("Amount in USDC").fill("10");
  await wallet(page).getByRole("button", { name: "Review" }).click();
  await expect(wallet(page).getByRole("button", { name: "Confirm deposit" })).toBeVisible({ timeout: 20_000 });
  await page.clock.fastForward(60_000);
  await wallet(page).getByRole("button", { name: "Confirm deposit" }).click();
  await expect(wallet(page).getByText("That price expired. Review it again.")).toBeVisible();
  expect(await sent()).toEqual([]);
  await setFeature(page, "cross_chain", false);
});

test("paying by card opens Privy's card flow for USDC on Base", async ({ page }) => {
  const customer = await newCustomer();
  await openDeposit(page, customer, "Card");
  await page.getByRole("button", { name: "Pay by card" }).click();
  const calls = await page.evaluate(() => (window as unknown as { __auraE2E?: { fundWallet: unknown[] } }).__auraE2E?.fundWallet ?? []);
  expect(calls).toEqual([{ address: customer.wallet.toLowerCase(),
    options: expect.objectContaining({ chain: expect.objectContaining({ id: 8453 }), asset: "USDC", defaultFundingMethod: "card" }) }]);
});

test("a card payment that doesn't finish is reported", async ({ page }) => {
  const customer = await newCustomer();
  await page.addInitScript(() => localStorage.setItem("aura-e2e-card", "fail"));
  await openDeposit(page, customer, "Card");
  await page.getByRole("button", { name: "Pay by card" }).click();
  await expect(toast(page, "Card payment didn't finish")).toBeVisible();
});
