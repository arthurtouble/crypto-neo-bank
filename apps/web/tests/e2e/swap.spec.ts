import type { Page } from "@playwright/test";
import { LIFI_DIAMOND } from "./support/fake-edge.mjs";
import { expect, outcome, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer, pauseAsset } from "./support/session";

// Feature 4 in docs/overview/feature-readiness.md: Swap. LI.FI, Privy's
// sponsored relay, the passkey, the chains, and Chainlink are the local fake;
// Aura's pages, API routes, quote checks, verifier, and D1 run for real. A
// same-network swap pays out in the same operation; a move to another network
// pays out once LI.FI reports delivery.

const ARBITRUM_USDC = "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
const toasts = (page: Page) => page.locator(".toastRegion");
const quote = (page: Page) => page.getByRole("region", { name: "Swap quote" });
const relayed = async () => ((await edge("/__sent")).sent ?? []).filter((item) => item.relayed);

async function balance(page: Page, customer: Customer, id: string) {
  const overview = await asCustomer(page, customer, "GET", "/api/overview") as { holdings: Array<{ id: string; amountRaw: string | null }> };
  return overview.holdings.find((item) => item.id === id)?.amountRaw ?? "0";
}

/** A customer with a passkey and 50 USDC on Base, on the Swap page. `from`/`to` open it on a pair, as Swap links do. */
async function openSwap(page: Page, options: { balances?: Partial<Record<1 | 8453, Record<string, string>>>; from?: string; to?: string } = {}) {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, options.balances ?? { 8453: { [ASSETS.usdc]: "50000000" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  const pair = new URLSearchParams({ ...(options.from ? { from: options.from } : {}), ...(options.to ? { to: options.to } : {}) });
  await page.goto(`/app/swap${pair.size ? `?${pair}` : ""}`);
  await expect(page.getByRole("heading", { name: "Swap", exact: true })).toBeVisible({ timeout: 30_000 });
  return customer;
}

async function getQuote(page: Page, amount: string) {
  await page.getByLabel("Amount to swap").fill(amount);
  await page.getByRole("button", { name: "Get quote" }).click();
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "swaps", true);
  await setFeature(page, "cross_chain", false);
});

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app/swap", "/api/swap/assets?q=usdc"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("USDC buys a tokenized stock on Base, with the reference price shown, and the chain confirms it", async ({ page }) => {
  const customer = await openSwap(page, { from: `8453:${ASSETS.usdc}`, to: `8453:${ASSETS.apple}` });
  await getQuote(page, "2");

  await expect(quote(page)).toContainText("You pay2 USDC", { timeout: 20_000 });
  await expect(quote(page)).toContainText("You receive about1.99 AAPLc");
  await expect(quote(page)).toContainText("You get at least1.98 AAPLc");
  await expect(quote(page)).toContainText("Network feePaid by Aura");
  await expect(quote(page).getByTestId("swap-reference")).toContainText("AAPLc reference price $341.51, as of");
  expect(await relayed()).toEqual([]);

  await quote(page).getByRole("button", { name: "Swap", exact: true }).click();
  await expect(outcome(page, "Swap complete")).toBeVisible({ timeout: 30_000 });
  const [operation] = await relayed();
  expect(operation.calls!.map((call) => call.to.toLowerCase())).toEqual([ASSETS.usdc, LIFI_DIAMOND]);
  expect(await balance(page, customer, `8453:${ASSETS.usdc}`)).toBe("48000000");
  expect(await balance(page, customer, `8453:${ASSETS.apple}`)).toBe("199000000");
});

test("USDC buys ETH on Base, confirmed from the ETH reaching the account, which leaves no token log", async ({ page }) => {
  const customer = await openSwap(page, { from: `8453:${ASSETS.usdc}`, to: "8453:native" });
  await getQuote(page, "2");
  await expect(quote(page)).toContainText("You get at least", { timeout: 20_000 });
  await quote(page).getByRole("button", { name: "Swap", exact: true }).click();
  await expect(outcome(page, "Swap complete")).toBeVisible({ timeout: 30_000 });
  expect(await balance(page, customer, `8453:${ASSETS.usdc}`)).toBe("48000000");
  expect(await balance(page, customer, "8453:native")).toBe("1990000000000000000");
});

test("a stock sells back to USDC, the other way round", async ({ page }) => {
  const customer = await openSwap(page, { balances: { 8453: { [ASSETS.apple]: "300000000" } }, from: `8453:${ASSETS.apple}`, to: `8453:${ASSETS.usdc}` });
  await expect(page.getByText("3 AAPLc available")).toBeVisible({ timeout: 20_000 });
  await getQuote(page, "1.5");
  await expect(quote(page)).toContainText("You receive about1.4925 USDC", { timeout: 20_000 });
  await quote(page).getByRole("button", { name: "Swap", exact: true }).click();
  await expect(outcome(page, "Swap complete")).toBeVisible({ timeout: 30_000 });
  expect(await balance(page, customer, `8453:${ASSETS.apple}`)).toBe("150000000");
  expect(await balance(page, customer, `8453:${ASSETS.usdc}`)).toBe("1492500");
});

test("a quote far from the reference price says so, in case the market is closed or thin", async ({ page }) => {
  await edge("/__state", { lifiUsd: { fromAmountUSD: "2.00", toAmountUSD: "1.99" } });
  await openSwap(page, { from: `8453:${ASSETS.usdc}`, to: `8453:${ASSETS.apple}` });
  // $2 for 1.99 AAPLc is about $1 each, far below the $341.51 reference.
  await getQuote(page, "2");
  await expect(quote(page).getByTestId("swap-reference")).toContainText("away from it. Markets may be closed or thin", { timeout: 20_000 });
});

test("the side that pays offers only what the account holds; the side that receives offers every network", async ({ page }) => {
  await openSwap(page);
  const options = (side: string, symbol: string) => page.getByRole("combobox", { name: side }).locator("option").filter({ hasText: new RegExp(`^${symbol} · `) });
  await expect(options("You pay", "USDC")).toHaveCount(1);
  await expect(options("You pay", "USDC")).toHaveText("USDC · USD Coin · 50 available", { timeout: 20_000 });
  await expect(options("You pay", "XAUt")).toHaveText(/^XAUt · Tether Gold on Ethereum/);
  await expect(options("You receive", "USDC")).toHaveCount(5);
  // What the account holds comes first on the side that pays.
  await expect(page.getByRole("combobox", { name: "You pay" }).locator("option").first()).toHaveText(/^USDC · /);
});

test("moving to another network is sent, then tracked: no spinner while the bridge delivers", async ({ page }) => {
  await setFeature(page, "cross_chain", true);
  await openSwap(page, { from: `8453:${ASSETS.usdc}`, to: ARBITRUM_USDC });
  await getQuote(page, "10");
  await expect(quote(page)).toContainText("Exchange and transfer fees", { timeout: 20_000 });
  await expect(quote(page)).toContainText("usually takes up to 30 minutes");
  await expect(quote(page).getByTestId("swap-leaves-aura")).toContainText("Aura doesn't show balances there");
  await quote(page).getByRole("button", { name: "Swap", exact: true }).click();

  const progress = page.getByRole("status").filter({ hasText: "Swap sent" });
  await expect(progress).toContainText("waiting for the bridge to deliver it on Arbitrum", { timeout: 30_000 });
  await expect(progress.locator(".spin")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New swap" })).toBeVisible();
  await expect(outcome(page, "Swap complete")).toHaveCount(0);
  await edge("/__state", { bridge: { status: "DONE", substatus: "COMPLETED" } });
  await expect(outcome(page, "Swap complete")).toBeVisible({ timeout: 45_000 });
});

test("Tether Gold sells from Ethereum back to USDC on Base, with Ethereum's fee paid by Aura", async ({ page }) => {
  await setFeature(page, "cross_chain", true);
  const customer = await openSwap(page, { balances: { 1: { [ASSETS.xaut]: "1000000" } }, from: `1:${ASSETS.xaut}`, to: `8453:${ASSETS.usdc}` });
  await expect(page.getByText("1 XAUt available")).toBeVisible({ timeout: 20_000 });
  await getQuote(page, "0.5");
  await expect(quote(page)).toContainText("You pay0.5 XAUt on Ethereum", { timeout: 20_000 });
  await expect(quote(page).getByTestId("swap-leaves-aura")).toHaveCount(0);
  await expect(quote(page)).toContainText("Network feePaid by Aura");
  await expect(quote(page).getByTestId("swap-reference")).toContainText("XAUt reference price $4,285.62");
  await quote(page).getByRole("button", { name: "Swap", exact: true }).click();

  await expect(page.getByRole("status").filter({ hasText: "Swap sent" })).toContainText("deliver it on Base", { timeout: 30_000 });
  const [operation] = await relayed();
  expect(operation).toMatchObject({ chainId: 1, success: true });
  expect(await balance(page, customer, `1:${ASSETS.xaut}`)).toBe("500000");
  await edge("/__state", { bridge: { status: "DONE", substatus: "COMPLETED" } });
  await expect(outcome(page, "Swap complete")).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => balance(page, customer, `8453:${ASSETS.usdc}`), { timeout: 20_000 }).toBe("497500");
});

test("when LI.FI has no route, is unavailable, or the price impact is too high, the customer is told why", async ({ page }) => {
  await openSwap(page);
  await edge("/__state", { lifiQuote: "no_route" });
  await getQuote(page, "5");
  await expect(toasts(page)).toContainText("We can't find a way to do this for that amount right now.", { timeout: 20_000 });

  await edge("/__state", { lifiQuote: "ok", down: ["lifi"] });
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(toasts(page)).toContainText("We can't get a price right now.", { timeout: 20_000 });

  await edge("/__state", { down: [], lifiQuote: "impact" });
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(toasts(page)).toContainText("lose about 10.0% to price impact. Try a smaller amount.", { timeout: 20_000 });
  await expect(quote(page)).toHaveCount(0);
  expect(await relayed()).toEqual([]);
});

test("switched off, or with a paused asset, there is no quote and nothing is sent", async ({ page }) => {
  await openSwap(page);
  await setFeature(page, "swaps", false);
  await getQuote(page, "5");
  await expect(toasts(page)).toContainText("Swaps aren't available right now.", { timeout: 20_000 });

  await setFeature(page, "swaps", true);
  const pause = (paused: boolean) => pauseAsset(page, `8453:${ASSETS.usdc}`, paused);
  await pause(true);
  await page.getByRole("button", { name: "Get quote" }).click();
  await expect(toasts(page)).toContainText("USDC is paused right now", { timeout: 20_000 });
  await pause(false);
  expect(await relayed()).toEqual([]);
});

test("more than the account holds gets no quote, in the form or from the server, and nothing is sent", async ({ page }) => {
  const customer = await openSwap(page, { from: `8453:${ASSETS.usdc}`, to: `8453:${ASSETS.apple}` });
  await expect(page.getByText("50 USDC available")).toBeVisible({ timeout: 20_000 });
  await getQuote(page, "500");
  await expect(page.getByRole("alert")).toHaveText("You have 50 USDC. Enter that or less.");
  await expect(quote(page)).toHaveCount(0);
  await expect(asCustomer(page, customer, "GET", `/api/routes/quote?from=8453:${ASSETS.usdc}&to=8453:${ASSETS.apple}&amount=500`)).rejects.toThrow(/422.*insufficient_balance/);
  expect(await relayed()).toEqual([]);
});

test("switched off, the form says so before anything is typed", async ({ page }) => {
  await setFeature(page, "swaps", false);
  await openSwap(page);
  await expect(page.getByText("Swaps aren't available right now.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Get quote" })).toBeDisabled();
});

test("an expired quote can't be confirmed; it asks for a fresh one", async ({ page }) => {
  // Quotes last 45 seconds, on the server as well as on screen, so this waits them out for real.
  test.setTimeout(120_000);
  await openSwap(page);
  await getQuote(page, "5");
  await expect(quote(page)).toContainText("Expires in", { timeout: 20_000 });
  await expect(quote(page).getByRole("button", { name: "Quote expired. Refresh" })).toBeVisible({ timeout: 60_000 });
  await expect(quote(page).getByRole("button", { name: "Swap", exact: true })).toHaveCount(0);
  await quote(page).getByRole("button", { name: "Quote expired. Refresh" }).click();
  await expect(quote(page)).toContainText("Expires in", { timeout: 20_000 });
  expect(await relayed()).toEqual([]);
});

test("cancelling the passkey prompt swaps nothing", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  await openSwap(page);
  await getQuote(page, "5");
  await quote(page).getByRole("button", { name: "Swap", exact: true }).click({ timeout: 20_000 });
  await expect(toast(page, "Cancelled")).toBeVisible({ timeout: 20_000 });
  expect(await relayed()).toEqual([]);
});

test("a swap that pays out less than the minimum is not marked complete", async ({ page }) => {
  await edge("/__state", { swapShortfall: true });
  await openSwap(page, { from: `8453:${ASSETS.usdc}`, to: `8453:${ASSETS.apple}` });
  await getQuote(page, "2");
  await quote(page).getByRole("button", { name: "Swap", exact: true }).click({ timeout: 20_000 });
  await expect(outcome(page, "Swap failed")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".transactionProgress")).toContainText("Less than the minimum arrived. Contact support.");
});
