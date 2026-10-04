import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page, Route, TestInfo } from "@playwright/test";
import { recoverTypedDataAddress } from "viem";
import { perpPosition } from "./support/fake-markets.mjs";
import { expect, test } from "./support/fixtures";
import { acceptTerms, ASSETS, edge, newCustomer, setBalances, setControls, setFeature, setIdentity, type Customer } from "./support/session";

// Perps on Hyperliquid. Hyperliquid's read API is the local fake (support/fake-markets.mjs), so every screen reads
// through Aura's real routes, switches, and D1. Placing a trade needs signatures Hyperliquid verifies, so the trade
// specs stub Aura's own write routes in the browser and check the screen drives them in order: add money through the
// action flow, connect this device's trading key with the passkey, then sign the trade on the device and relay it.
// Predictions are in markets.spec.ts.

const flow = (page: Page) => page.locator(".mkFlow");
const sheet = (page: Page) => page.getByRole("dialog");
const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");

/** Screenshots for design review, when MARKETS_SCREENSHOTS names a folder. */
async function shot(page: Page, info: TestInfo, name: string, options: { suffix?: string; full?: boolean } = {}) {
  const dir = process.env.MARKETS_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const full = options.full ?? !(await sheet(page).isVisible());
  // A full-page capture of a scrolled page draws the sticky bar mid-page; start from the top.
  if (full) await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, `${name}-${isPhone(info) ? "phone" : "desktop"}${options.suffix ?? ""}.png`), fullPage: full });
}

async function signIn(page: Page, usdc = "250000000"): Promise<Customer> {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: usdc } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  return customer;
}

/** Type a dollar amount: the keypad on the phone, the field on desktop. */
async function enterAmount(scope: Locator, info: TestInfo, amount: string) {
  if (isPhone(info)) {
    const keypad = scope.getByRole("group", { name: "Keypad" });
    for (const key of amount) await keypad.getByRole("button", { name: key, exact: true }).click();
  } else {
    await scope.getByRole("textbox", { name: /^Amount/ }).fill(amount);
  }
}

/** A perp's order form: the panel beside the book on desktop, with its side picked; the sheet that Long or Short opens on the phone. */
async function openOrder(page: Page, info: TestInfo, side: "long" | "short"): Promise<Locator> {
  const label = side === "long" ? "Long" : "Short";
  if (isPhone(info)) {
    await page.getByRole("button", { name: new RegExp(`^${label} Price goes`) }).click({ timeout: 30_000 });
    await expect(sheet(page).getByRole("heading", { name: new RegExp(`^${label} `) })).toBeVisible();
    return sheet(page);
  }
  const panel = page.getByRole("complementary", { name: "Place an order" });
  await panel.getByRole("radio", { name: new RegExp(`^${label} Price goes`) }).click({ timeout: 30_000 });
  return panel;
}

/** The order book: beside the chart on desktop, a tab under it on the phone. */
async function showBook(page: Page, info: TestInfo) {
  if (isPhone(info)) await page.getByRole("tab", { name: "Order book" }).click();
  return page.getByTestId("perps-book");
}

const observed = <T>(source: "hyperliquid", data: T) => ({ status: "observed", source, observedAt: new Date().toISOString(), data });
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const signRequest = { version: 1, method: "POST", url: "http://127.0.0.1/privy/v1/wallets/w/rpc", body: {}, headers: {} };
const requestId = "8a6f0f8e-1d2b-4c3d-9e4f-5a6b7c8d9e0f";

/** Aura's perps account reply for a stubbed account. */
function accountReply(state: { accountValue: string; totalMarginUsed?: string; withdrawable: string; positions?: unknown[] }, connected: boolean, orders: unknown[] = []) {
  const full = { dex: "", totalMarginUsed: "0", crossAccountValue: state.accountValue, crossMaintenanceMarginUsed: "0", positions: [], time: Date.now(), ...state };
  return { owner: "0x1", connection: connected ? { status: "ready", tradingKey: "0x1", approvedAt: new Date().toISOString() } : null,
    state: observed("hyperliquid", full), dexStates: observed("hyperliquid", [full]), orders: observed("hyperliquid", orders), fills: observed("hyperliquid", []) };
}

/** A deposit action as Aura's action flow sees it: submitted, then `final` on every status read. */
async function stubDepositAction(page: Page, id: string, final: { status: "confirmed" | "failed" | "settling"; destinationChainId: number | null }, summary: Record<string, unknown> = {}) {
  const action = (status: string) => ({ id, kind: final.destinationChainId ? "route" : "transfer", chainId: 8453, status, summary, calls: [{ to: ASSETS.usdc, value: "0", data: "0x" }],
    usdCents: 1000, transactionHash: `0x${"ab".repeat(32)}`, destinationChainId: final.destinationChainId, destinationTransactionHash: null,
    failureReason: final.status === "failed" ? "reverted" : null, createdAt: new Date().toISOString() });
  await page.route(`**/api/actions/${id}/authorize`, (route) => json(route, { request: signRequest }));
  await page.route(`**/api/actions/${id}/submit`, (route) => json(route, { action: action("submitted") }));
  await page.route(`**/api/actions/${id}`, (route) => json(route, { action: action(final.status) }));
  return action("prepared");
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "perps", true);
  await setFeature(page, "predictions", true);
});

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app/perps", "/app/perps/BTC", "/app/predictions", "/app/predictions/5001"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("guests see labelled example perps, and trading asks them to sign in", async ({ page }, info) => {
  await page.goto("/app/perps");
  await expect(page.getByRole("heading", { name: "Perps", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("note")).toContainText("Example data");
  await expect(page.getByTestId("perps-account-value")).toHaveText("$1,286.40");
  await expect(page.getByRole("list", { name: "Perp markets" }).getByRole("link", { name: /^SPCX/ })).toBeVisible();
  await expect(page.getByText("Example data, shaped like Hyperliquid's").first()).toBeVisible();
  // The example position shows what a real one does: TP/SL and Close, which ask a guest to sign in.
  await expect(page.getByRole("listitem", { name: "BTC long" }).getByRole("button")).toHaveText(["Take profit / Stop loss", "Close"]);
  await shot(page, info, "guest-perps");
});

test("the menu has Perps and Predictions, and old Markets links still open them", async ({ page }, info) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/app/markets");
  await expect(page).toHaveURL(/\/app\/perps$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Perps", exact: true })).toBeVisible({ timeout: 30_000 });
  if (isPhone(info)) await page.getByRole("button", { name: "Open menu" }).click();
  const nav = page.getByRole("navigation", { name: isPhone(info) ? "Sections" : "Primary" });
  await expect(nav.getByRole("link", { name: "Perps" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Predictions" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Markets", exact: true })).toHaveCount(0);
  if (isPhone(info)) await page.keyboard.press("Escape");
  await page.goto("/app/markets/perps/xyz%3ASPCX");
  await expect(page).toHaveURL(/\/app\/perps\/xyz%3ASPCX$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "SPCX", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto("/app/markets?view=predictions");
  await expect(page).toHaveURL(/\/app\/predictions$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Predictions", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.goto("/app/markets/predictions/5001?outcome=1");
  await expect(page).toHaveURL(/\/app\/predictions\/5001\?outcome=1$/, { timeout: 30_000 });
});

test("with the switch off, Perps says it isn't available yet", async ({ page }) => {
  await setFeature(page, "perps", false);
  await signIn(page);
  await page.goto("/app/perps");
  await expect(page.getByRole("heading", { name: "Perps aren't available yet" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("perps-account-value")).toHaveCount(0);
});

test("a new customer, switch on: an empty perps account with Add money as the one action, not an error", async ({ page }, info) => {
  const failed: string[] = [];
  page.on("response", (response) => { if (response.url().includes("/api/perps/") && response.status() >= 500) failed.push(`${response.status()} ${response.url()}`); });
  await signIn(page);
  await page.goto("/app/perps");
  await expect(page.getByTestId("perps-account-value")).toHaveText("$0.00", { timeout: 30_000 });
  await expect(page.getByTestId("perps-empty")).toHaveText("Add USDC from your Aura account to start trading. At least $6.");
  const account = page.getByRole("region", { name: "Perps account" });
  await expect(account.getByRole("button")).toHaveText(["Add money"]);
  await expect(account.getByRole("button", { name: "Add money" })).toHaveClass(/appButtonPrimary/);
  await expect(page.getByText("No open positions.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Perp markets" }).getByRole("link")).toHaveCount(5);
  await shot(page, info, "perps-new-customer");
  expect(failed).toEqual([]);
});

test("where Hyperliquid doesn't serve, Perps says so before anything is filled in, and closing still works", async ({ page }, info) => {
  const customer = await signIn(page);
  await edge("/__markets", { hyperliquid: { [customer.wallet]: { accountValue: "400.00", withdrawable: "100.00",
    positions: [perpPosition({ coin: "BTC", size: "0.05", entryPx: "62900.0", positionValue: "3212.50", unrealizedPnl: "67.50", marginUsed: "321.25" })] } } });
  await page.setExtraHTTPHeaders({ "CF-IPCountry": "US" });
  await page.goto("/app/perps");
  const notice = "Perps aren't available where you are. You can still close positions and withdraw.";
  await expect(page.getByTestId("perps-blocked")).toHaveText(notice, { timeout: 30_000 });
  const account = page.getByRole("region", { name: "Perps account" });
  await expect(account.getByRole("button", { name: "Add money" })).toBeDisabled();
  await expect(account.getByRole("button", { name: "Withdraw" })).toBeEnabled();
  await expect(page.getByRole("listitem", { name: "BTC long" }).getByRole("button", { name: "Close" })).toBeEnabled();
  await page.goto("/app/perps/BTC");
  if (isPhone(info)) {
    await expect(page.getByTestId("perps-trade-blocked")).toHaveText(notice, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Long Price goes/ })).toBeDisabled();
  } else {
    const panel = page.getByRole("complementary", { name: "Place an order" });
    await expect(panel.getByTestId("perps-order-blocked")).toHaveText(notice, { timeout: 30_000 });
    await expect(panel.getByRole("button", { name: "Long BTC" })).toBeDisabled();
  }
  await shot(page, info, "perps-place-blocked");
});

test("a locked account says so on Perps, and every trade, add, and withdrawal waits", async ({ page }) => {
  const customer = await signIn(page);
  await edge("/__markets", { hyperliquid: { [customer.wallet]: { accountValue: "400.00", withdrawable: "100.00",
    positions: [perpPosition({ coin: "BTC", size: "0.05", entryPx: "62900.0", positionValue: "3212.50", unrealizedPnl: "67.50", marginUsed: "321.25" })] } } });
  await setControls(page, customer, { accountLocked: true });
  await page.goto("/app/perps");
  await expect(page.getByTestId("perps-blocked")).toHaveText("Your account is locked. Unlock it in Settings to trade, add money, or withdraw.", { timeout: 30_000 });
  const account = page.getByRole("region", { name: "Perps account" });
  await expect(account.getByRole("button", { name: "Add money" })).toBeDisabled();
  await expect(account.getByRole("button", { name: "Withdraw" })).toBeDisabled();
  await expect(page.getByRole("listitem", { name: "BTC long" }).getByRole("button", { name: "Close" })).toBeDisabled();
});

test("perps home: the account, positions with TP/SL, orders, and history from Hyperliquid, and markets with search", async ({ page }, info) => {
  const customer = await signIn(page);
  await edge("/__markets", { hyperliquid: { [customer.wallet]: {
    accountValue: "1286.40", withdrawable: "965.10",
    positions: [perpPosition({ coin: "BTC", size: "0.05", entryPx: "62900.0", positionValue: "3212.50", unrealizedPnl: "67.50", marginUsed: "321.25", liquidationPx: "50820.0" })],
    orders: [{ coin: "ETH", side: "B", limitPx: "2950.0", sz: "0.2", origSz: "0.2", oid: 77, timestamp: Date.now() - 60_000, orderType: "Limit", reduceOnly: false,
      isTrigger: false, triggerPx: "0.0", isPositionTpsl: false, tif: "Gtc" },
    { coin: "BTC", side: "A", limitPx: "63000.0", sz: "0.0", origSz: "0.0", oid: 78, timestamp: Date.now() - 60_000, orderType: "Take Profit Market", reduceOnly: true,
      isTrigger: true, triggerPx: "70000.0", isPositionTpsl: true, tif: null }],
    fills: [{ coin: "BTC", px: "62900.0", sz: "0.05", side: "B", time: Date.now() - 86_400_000, dir: "Open Long", closedPnl: "0.0", fee: "1.41", feeToken: "USDC",
      oid: 70, tid: 1, hash: `0x${"0".repeat(63)}1` }]
  } } });
  await page.goto("/app/perps");
  await expect(page.getByTestId("perps-account-value")).toHaveText("$1,286.40", { timeout: 30_000 });
  // Available to trade is the value less the margin in use, as Hyperliquid's order form says it; withdrawing keeps more back.
  await expect(page.getByTestId("perps-available")).toHaveText("$965.15");
  await expect(page.getByTestId("perps-withdrawable")).toHaveText("$965.10");
  await expect(page.getByText(/^From Hyperliquid at /).first()).toBeVisible();
  const position = page.getByRole("listitem", { name: "BTC long" });
  await expect(position).toContainText("Long 10x");
  await expect(position.getByTestId("perps-position-pnl")).toHaveText("+$67.50");
  await expect(position).toContainText("Entry price$62,900.00");
  await expect(position).toContainText("Price now$64,250.00");
  await expect(position).toContainText("Liquidation price$50,820.00");
  await expect(position).toContainText("Take profit$70,000.00");
  await expect(position).toContainText("Stop loss—");
  await expect(position.getByRole("button")).toHaveText(["Take profit / Stop loss", "Close"]);
  await shot(page, info, "perps-home");
  await page.getByRole("tab", { name: /Open orders/ }).click();
  await expect(page.getByText("Limit buy ETH")).toBeVisible();
  await expect(page.getByText("Take profit on BTC")).toBeVisible();
  await expect(page.getByText(/Closes the whole position when the price reaches \$70,000\.00/)).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Opened long BTC")).toBeVisible();
  await page.getByRole("tab", { name: /Positions/ }).click();

  const markets = page.getByRole("list", { name: "Perp markets" });
  await expect(markets.getByRole("link")).toHaveCount(5);
  // A stock perp shows its name without the dex prefix, with its max leverage.
  await expect(markets.getByRole("link", { name: /^SPCX 10x/ })).toContainText("Stock perp");
  await expect(markets).not.toContainText("xyz:");
  await expect(markets.getByRole("link", { name: /^BTC 40x/ })).toContainText("$64,250.00");
  await expect(markets.getByRole("link", { name: /^BTC 40x/ })).toContainText("+1.81%");
  await page.getByPlaceholder("Search markets").fill("nvd");
  await expect(markets.getByRole("link")).toHaveCount(1);
  await expect(markets.getByRole("link")).toContainText("NVDA");
});

test("a perps market page: price and stats, chart ranges, the order book with grouping, and an order priced by the server", async ({ page }, info) => {
  test.setTimeout(90_000); // Visits two markets and steps through grouping, the order form, and the book.
  const customer = await signIn(page);
  await edge("/__markets", { hyperliquid: { [customer.wallet]: { accountValue: "500", withdrawable: "500" } } });
  const candleRanges: string[] = [];
  const bookQueries: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/perps/candles") candleRanges.push(url.searchParams.get("range") ?? "");
    if (url.pathname === "/api/perps/book") bookQueries.push(url.search);
  });
  await page.goto("/app/perps/BTC");
  await expect(page.getByTestId("perps-market-price")).toHaveText("$64,250.00", { timeout: 30_000 });
  // The breadcrumb, the day's change in dollars and percent, and the stats in one line.
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toContainText("Perps");
  await expect(crumbs).toContainText("Crypto");
  await expect(crumbs).toContainText("40x");
  await expect(crumbs.getByRole("link", { name: "Perps" })).toHaveAttribute("href", "/app/perps");
  await expect(page.getByTestId("perps-market-change")).toHaveText("+$1,140.00 (+1.81%) today");
  const stats = page.getByTestId("perps-market-stats");
  await expect(stats).toContainText("Traded in 24h$2.1B");
  await expect(stats).toContainText("Open interest");
  await expect(stats).toContainText(/Funding, hourly\+0\.001\d%/);
  await expect(page.getByText("Funding: longs pay shorts")).toBeVisible();
  await expect(page.getByText("No open positions.")).toBeVisible();

  // The chart: 1D first, each range reads its own candles, and Live keeps reading.
  const chart = page.getByRole("region", { name: "BTC price chart" });
  await expect(chart.getByTestId("perps-chart")).toBeVisible({ timeout: 20_000 });
  const ranges = chart.getByRole("radiogroup", { name: "Chart range" });
  await expect(ranges.getByRole("radio")).toHaveText(["Live", "1H", "1D", "1W", "1M", "3M", "1Y", "All"]);
  await expect(ranges.getByRole("radio", { name: "1D" })).toHaveAttribute("aria-checked", "true");
  await ranges.getByRole("radio", { name: "1W" }).click();
  await expect.poll(() => candleRanges.includes("1w")).toBe(true);
  await chart.getByRole("radio", { name: "Candles" }).click();
  await expect(chart.locator(".mkCandleUp, .mkCandleDown").first()).toBeVisible();
  await ranges.getByRole("radio", { name: "Live" }).click();
  await expect.poll(() => candleRanges.filter((range) => range === "live").length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await chart.getByRole("radio", { name: "Line" }).click();

  // The order book: asks above the spread, bids below, with totals in dollars, and it keeps refreshing.
  const book = await showBook(page, info);
  await expect(book.getByRole("columnheader")).toHaveText(["Price (USD)", "Amount (BTC)", "Total (USD)"], { timeout: 20_000 });
  await expect(page.getByTestId("perps-spread")).toHaveText(/^Spread\s*\$1\.00\s*0\.002%$/);
  const asks = book.getByRole("rowgroup", { name: "Asks" }).getByRole("row");
  const bids = book.getByRole("rowgroup", { name: "Bids" }).getByRole("row");
  await expect(asks).toHaveCount(isPhone(info) ? 8 : 10);
  // The best ask sits next to the spread, the best bid just below it.
  await expect(asks.last().getByRole("cell").first()).toHaveText("64,251.00");
  await expect(bids.first().getByRole("cell").first()).toHaveText("64,250.00");
  await expect(bids.first().getByRole("cell").last()).toHaveText(/^\$[\d,]+$/);
  const reads = bookQueries.length;
  await expect.poll(() => bookQueries.length, { timeout: 10_000 }).toBeGreaterThan(reads + 1);

  // Grouping: dollar steps that suit BTC's price, as Hyperliquid offers them.
  await page.getByRole("button", { name: "Group prices by $1" }).click();
  const steps = page.getByRole("radiogroup", { name: "Group prices by" });
  await expect(steps.getByRole("radio")).toHaveText(["$1", "$2", "$5", "$10", "$100", "$1,000"]);
  await shot(page, info, "perps-book-grouping", { full: false });
  await steps.getByRole("radio", { name: "$10", exact: true }).click();
  await expect(steps).toHaveCount(0);
  await expect.poll(() => bookQueries.some((query) => query.includes("sig=4"))).toBe(true);
  await expect(bids.first().getByRole("cell").first()).toHaveText("64,250.00", { timeout: 10_000 });
  await expect(asks.last().getByRole("cell").first()).toHaveText("64,260.00");
  await page.getByRole("button", { name: "Group prices by $10" }).click();
  await steps.getByRole("radio", { name: "$5", exact: true }).click();
  await expect.poll(() => bookQueries.some((query) => query.includes("sig=5&mantissa=5"))).toBe(true);
  await expect(asks.last().getByRole("cell").first()).toHaveText("64,255.00", { timeout: 10_000 });
  if (isPhone(info)) await page.getByRole("tab", { name: /Positions/ }).click();
  await shot(page, info, "perps-market");
  if (!isPhone(info)) {
    // Dark mode, as the theme setting or the device chooses it.
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await shot(page, info, "perps-market", { suffix: "-dark" });
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  }

  // The order form: the panel on desktop, the sheet on the phone.
  const form = await openOrder(page, info, "long");
  await expect(form.getByRole("group", { name: "Amount shortcuts" }).getByRole("button")).toHaveText(["25%", "50%", "75%", "Max"]);
  // What's in perps to trade, and the Base USDC one tap can add first ($250 less a dollar kept for the network fee); Max counts both.
  await expect(form.getByTestId("perps-order-available")).toHaveText("$500.00 to trade");
  await expect(form.getByTestId("perps-order-from-base")).toContainText("Plus $249.00 of your USDC on Base");
  await form.getByRole("button", { name: "Max" }).click();
  if (!isPhone(info)) await expect(form.getByRole("textbox", { name: /^Amount/ })).toHaveValue("749");
  // Leverage starts at the market's maximum.
  const leverage = form.getByRole("spinbutton", { name: "Leverage, times" });
  await expect(leverage).toHaveValue("40");
  await expect(form.getByRole("slider")).toHaveValue("40");
  if (isPhone(info)) { for (let i = 0; i < 3; i += 1) await form.getByRole("group", { name: "Keypad" }).getByRole("button", { name: "Delete" }).click(); }
  await enterAmount(form, info, "20");
  await form.getByLabel("Margin mode").selectOption("isolated");
  // Only digits go into number fields.
  await leverage.fill("4x");
  await expect(leverage).toHaveValue("4");
  await expect(form.getByRole("slider")).toHaveValue("4");
  await leverage.fill("5");
  // Isolated at 5x: the server's estimate, 64,250 × (1 − 1/5 × …), and its fee at the account's rate.
  await expect(form.getByTestId("perps-liquidation")).toHaveText(/^\$5\d,\d{3}\.\d{2}$/, { timeout: 20_000 });
  await expect(form).toContainText("Position size$");
  // The server rounds the size to what Hyperliquid takes, so the margin is a little under $20.
  await expect(form).toContainText(/Margin\$(19\.\d{2}|20\.00)/);
  await expect(form.getByTestId("perps-fee")).toHaveText(/^\$0\.0[45]$/);
  await expect(form.getByRole("button", { name: "Long BTC" })).toBeEnabled();
  await shot(page, info, "perps-order-sheet");
  // TP/SL: letters are dropped, the wrong side of the price is caught, and each says what it would make or lose.
  await form.getByText("Take profit / Stop loss").click();
  const takeProfit = form.getByLabel("Take profit at");
  await takeProfit.fill("6o000");
  await expect(takeProfit).toHaveValue("6000");
  await expect(form.getByText("Take profit must be above the price.")).toBeVisible();
  await expect(form.getByRole("button", { name: "Long BTC" })).toBeDisabled();
  await takeProfit.fill("70000");
  await form.getByLabel("Stop loss at").fill("60000");
  await expect(form.getByText(/^Profit of about \$/)).toBeVisible({ timeout: 20_000 });
  await expect(form.getByText(/^Loss of about \$/)).toBeVisible();
  await expect(form.getByRole("button", { name: "Long BTC" })).toBeEnabled();
  await shot(page, info, "perps-order-tpsl");
  if (!isPhone(info)) {
    await form.getByRole("radio", { name: /^Short Price goes/ }).click();
    await expect(form.getByRole("button", { name: "Short BTC" })).toBeVisible();
  } else {
    await sheet(page).getByRole("button", { name: "Close" }).first().click();
    await expect(sheet(page)).toHaveCount(0);
  }

  // Picking a price in the book: an ask means a long (buy) at that price, a bid a short (sell), as a limit order.
  await showBook(page, info);
  await asks.last().click();
  const picked = isPhone(info) ? sheet(page) : page.getByRole("complementary", { name: "Place an order" });
  if (isPhone(info)) await expect(picked.getByRole("heading", { name: "Long BTC" })).toBeVisible();
  else await expect(picked.getByRole("radio", { name: /^Long Price goes/ })).toHaveAttribute("aria-checked", "true");
  await expect(picked.getByRole("radio", { name: "Limit" })).toHaveAttribute("aria-checked", "true");
  await expect(picked.getByLabel("Limit price")).toHaveValue("64255");
  await picked.getByLabel("Limit price").fill("64,2a50.5");
  await expect(picked.getByLabel("Limit price")).toHaveValue("64250.5");
  if (isPhone(info)) {
    await sheet(page).getByRole("button", { name: "Close" }).first().click();
    await bids.first().click();
    await expect(sheet(page).getByRole("heading", { name: "Short BTC" })).toBeVisible();
    await sheet(page).getByRole("button", { name: "Close" }).first().click();
    await page.getByRole("tab", { name: /Positions/ }).click();
  } else {
    await bids.first().click();
    await expect(picked.getByRole("radio", { name: /^Short Price goes/ })).toHaveAttribute("aria-checked", "true");
    await expect(picked.getByLabel("Limit price")).toHaveValue("64250");
  }

  // Switching market from the name: stocks are listed under Stocks, without the dex.
  await page.getByRole("heading", { level: 1 }).getByRole("button", { name: "BTC" }).click();
  const switcher = page.getByRole("dialog", { name: "Switch market" });
  await expect(switcher.getByRole("heading")).toHaveText(["Crypto", "Stocks"]);
  await switcher.getByRole("link", { name: /^SPCX/ }).click();
  await expect(page).toHaveURL(/\/app\/perps\/xyz%3ASPCX$/);
  await expect(page.getByRole("heading", { name: "SPCX", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Stocks");
  await expect(page.getByText("A stock perp on the xyz market")).toBeVisible();
});

test("a chart, book, or fee Hyperliquid didn't answer shows as unavailable", async ({ page }, info) => {
  const customer = await signIn(page);
  await edge("/__markets", { hyperliquid: { [customer.wallet]: { accountValue: "500", withdrawable: "500" } } });
  const unavailable = { status: "unavailable", source: "hyperliquid", observedAt: new Date().toISOString(), reason: "Hyperliquid didn't answer.", traceId: "t" };
  await page.route(/\/api\/perps\/candles\?/, (route) => json(route, unavailable));
  await page.route(/\/api\/perps\/book\?/, (route) => json(route, unavailable));
  await page.route("**/api/perps/trade/preview", async (route) => {
    const response = await route.fetch();
    await json(route, { ...await response.json(), fee: null, feeRate: null }, response.status());
  });
  await page.goto("/app/perps/BTC");
  await expect(page.getByTestId("perps-chart-unavailable")).toBeVisible({ timeout: 30_000 });
  if (isPhone(info)) await page.getByRole("tab", { name: "Order book" }).click();
  await expect(page.getByTestId("perps-book-unavailable")).toBeVisible();
  await expect(page.getByTestId("perps-book")).toHaveCount(0);
  if (isPhone(info)) await page.getByRole("tab", { name: /Positions/ }).click();
  const form = await openOrder(page, info, "long");
  await enterAmount(form, info, "20");
  await expect(form).toContainText("Position size$", { timeout: 20_000 });
  await expect(form.getByTestId("perps-fee")).toHaveText("Unavailable");
});

test("one tap opens a long: adds money through the action flow, connects this device with the passkey, then signs the order here", async ({ page }, info) => {
  await signIn(page);
  let connected = false, funded = false, agent = "";
  const calls: string[] = [];
  // What Aura's trade route builds for the device to sign: one Hyperliquid L1 action.
  const typedData = { domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
    types: { Agent: [{ name: "source", type: "string" }, { name: "connectionId", type: "bytes32" }] }, primaryType: "Agent",
    message: { source: "a", connectionId: `0x${"12".repeat(32)}` } } as const;
  await page.route("**/api/perps/account", (route) => json(route, accountReply({ accountValue: funded ? "20" : "0", withdrawable: funded ? "20" : "0" }, connected)));
  const deposit = await stubDepositAction(page, "perps-deposit-1", { status: "confirmed", destinationChainId: 1337 });
  await page.route("**/api/perps/deposit", async (route) => { calls.push(`deposit ${route.request().postDataJSON().amount}`); funded = true; await json(route, { action: deposit }, 201); });
  await page.route("**/api/perps/setup", async (route) => {
    agent = route.request().postDataJSON().agent;
    calls.push("setup"); await json(route, { status: "sign", requestId, request: signRequest });
  });
  await page.route("**/api/perps/signatures", async (route) => { calls.push("signatures"); connected = true; await json(route, { status: "accepted", kind: "setup" }); });
  await page.route("**/api/perps/trade", async (route) => {
    calls.push(`trade ${JSON.stringify(route.request().postDataJSON())}`);
    await json(route, { status: "sign", requestId, owner: "0x1", typedData: [typedData] }, 202);
  });
  let signature = "";
  await page.route("**/api/perps/relay", async (route) => {
    const body = route.request().postDataJSON() as { requestId: string; signatures: string[] };
    calls.push(`relay ${body.requestId}`);
    signature = body.signatures[0];
    await json(route, { statuses: [{ kind: "filled", oid: 9, totalSz: "0.0015", avgPx: "64250.0" }], size: "0.0015", margin: "20", notional: "96.37", liquidationPrice: null }, 201);
  });

  await page.goto("/app/perps/BTC");
  const form = await openOrder(page, info, "long");
  await enterAmount(form, info, "15");
  await expect(form).toContainText("Added from USDC first$16.00", { timeout: 20_000 });
  // The button says what the tap does: add money first, then go long.
  await form.getByRole("button", { name: "Add money and long BTC" }).click();
  await expect(flow(page)).toContainText("Order placed. 0.0015 BTC at $64,250.00.", { timeout: 30_000 });
  await shot(page, info, "perps-order-placed");
  // Leverage defaults to the market's maximum, 40x for BTC.
  expect(calls).toEqual(["deposit 16.00", "setup", "signatures",
    `trade ${JSON.stringify({ coin: "BTC", side: "long", marginUsd: "15.00", leverage: 40, isCross: true, type: "market" })}`, `relay ${requestId}`]);
  // The order was signed in the browser by the key this device made and had approved, not by Aura's server.
  expect(agent).toMatch(/^0x[0-9a-f]{40}$/);
  expect((await recoverTypedDataAddress({ ...typedData, signature: signature as `0x${string}` })).toLowerCase()).toBe(agent);
});

test("adding money finishes when the perps account shows it, and the sheet closes at any point", async ({ page }, info) => {
  await signIn(page);
  let funded = false;
  await page.route("**/api/perps/account", (route) => json(route, accountReply({ accountValue: funded ? "7.94" : "0", withdrawable: funded ? "7.94" : "0" }, true)));
  // The action stays in delivery, as it did on dev; the perps account shows the money first.
  const deposit = await stubDepositAction(page, "perps-deposit-2", { status: "settling", destinationChainId: 1337 },
    { tool: "relay_direct", fromAmountRaw: "8000000", toAmountRaw: "7980000" });
  await page.route("**/api/perps/deposit", async (route) => { await json(route, { action: deposit }, 201); });
  await page.goto("/app/perps");
  await page.getByRole("button", { name: "Add money" }).click({ timeout: 30_000 });
  const add = page.getByRole("dialog", { name: "Add money to perps" });
  // Closing before anything is sent.
  await add.getByRole("button", { name: "Close" }).first().click();
  await expect(add).toHaveCount(0);
  await page.getByRole("button", { name: "Add money" }).click();
  await enterAmount(add, info, "8");
  await add.getByRole("button", { name: "Add money", exact: true }).click();
  await expect(add.locator(".mkFlow")).toContainText("Adding money", { timeout: 20_000 });
  await shot(page, info, "perps-add-money");
  await expect(add.getByRole("button", { name: "Close" }).first()).toBeEnabled();
  funded = true;
  await expect(add.locator(".mkFlow")).toContainText("Network fee $0.02", { timeout: 20_000 });
  await expect(add.locator(".mkFlow")).toContainText("$7.98 added to perps ($8.00 less a $0.02 network fee).", { timeout: 30_000 });
  await add.getByRole("button", { name: "Done" }).click();
  await expect(add).toHaveCount(0);
  await expect(page.getByTestId("perps-account-value")).toHaveText("$7.94", { timeout: 30_000 });

  // While it's still moving, Close works and leaves it to finish.
  funded = false;
  await page.getByRole("button", { name: "Add money" }).click();
  await enterAmount(add, info, "8");
  await add.getByRole("button", { name: "Add money", exact: true }).click();
  await expect(add.getByText("You can close this. The money keeps moving")).toBeVisible({ timeout: 20_000 });
  await add.getByRole("button", { name: "Close" }).first().click();
  await expect(add).toHaveCount(0);
});

test("a position: TP/SL replaces the old one, and Close takes part of it at a limit price", async ({ page }, info) => {
  await signIn(page);
  const calls: string[] = [];
  const position = { coin: "BTC", size: "0.05", entryPx: "62900.0", positionValue: "3212.50", unrealizedPnl: "67.50", returnOnEquity: "0.21",
    liquidationPx: "50820.0", leverage: { type: "cross", value: 10 }, marginUsed: "321.25" };
  const takeProfit = { coin: "BTC", side: "sell", limitPx: "63000.0", size: "0", origSize: "0", oid: 78, timestamp: Date.now(), orderType: "Take Profit Market",
    reduceOnly: true, isTrigger: true, triggerPx: "70000.0", isPositionTpsl: true, tif: null };
  await page.route("**/api/perps/account", (route) => json(route, accountReply({ accountValue: "1286.40", totalMarginUsed: "321.25", withdrawable: "965.10", positions: [position] }, true, [takeProfit])));
  await page.route("**/api/perps/positions/tpsl", async (route) => { calls.push(`tpsl ${JSON.stringify(route.request().postDataJSON())}`); await json(route, { statuses: [{ kind: "waiting", for: "trigger" }] }); });
  await page.route("**/api/perps/orders/cancel", async (route) => { calls.push(`cancel ${route.request().postDataJSON().oid}`); await json(route, { statuses: [{ kind: "success" }] }); });
  await page.route("**/api/perps/orders", async (route) => { calls.push(`order ${JSON.stringify(route.request().postDataJSON())}`); await json(route, { statuses: [{ kind: "resting", oid: 90 }] }, 201); });
  await page.goto("/app/perps");
  const row = page.getByRole("listitem", { name: "BTC long" });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await shot(page, info, "perps-position");

  await row.getByRole("button", { name: "Take profit / Stop loss" }).click({ timeout: 30_000 });
  const tpsl = page.getByRole("dialog", { name: "Take profit and stop loss, BTC long" });
  await expect(tpsl).toContainText("Take profit at $70,000.00");
  await tpsl.getByLabel("Take profit at").fill("72000");
  await expect(tpsl.getByText(/^Profit of about \$455\.00 on the whole position$/)).toBeVisible();
  await tpsl.getByLabel("Stop loss at").fill("66000");
  await expect(tpsl.getByText("Stop loss must be below the price.")).toBeVisible();
  await tpsl.getByLabel("Stop loss at").fill("60000");
  await tpsl.getByRole("button", { name: "Set", exact: true }).click();
  await expect(tpsl).toContainText("Take profit and stop loss set.");
  await tpsl.getByRole("button", { name: "Done" }).click();

  await row.getByRole("button", { name: "Close" }).click();
  const close = page.getByRole("dialog", { name: "Close BTC long" });
  await close.getByRole("radio", { name: "Limit" }).click();
  await close.getByRole("button", { name: "50%" }).click();
  await close.getByLabel("Limit price").fill("66000");
  await expect(close).toContainText("Closing0.025 BTC of 0.05 BTC");
  await expect(close).toContainText("Estimated profit+$77.50");
  await shot(page, info, "perps-close-sheet");
  await close.getByRole("button", { name: "Close 50%" }).click();
  await expect(close).toContainText("Close order placed at $66,000.00.");
  expect(calls).toEqual([
    `tpsl ${JSON.stringify({ coin: "BTC", takeProfit: { triggerPrice: "72000" }, stopLoss: { triggerPrice: "60000" } })}`, "cancel 78",
    `order ${JSON.stringify({ coin: "BTC", side: "sell", size: "0.025", type: "limit", reduceOnly: true, limitPrice: "66000" })}`]);
});

test("a cancelled passkey stops the trade and says so", async ({ page }, info) => {
  await signIn(page);
  await page.addInitScript(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  let traded = false;
  await page.route("**/api/perps/setup", (route) => json(route, { status: "sign", requestId, request: signRequest }));
  await page.route("**/api/perps/trade", async (route) => { traded = true; await json(route, { statuses: [] }, 201); });
  await page.route("**/api/perps/account", (route) => json(route, accountReply({ accountValue: "100", withdrawable: "100" }, false)));
  await page.goto("/app/perps/ETH");
  const form = await openOrder(page, info, "short");
  await enterAmount(form, info, "10");
  await form.getByRole("button", { name: "Short ETH" }).click();
  await expect(flow(page)).toContainText("You cancelled. Nothing more was sent.", { timeout: 20_000 });
  expect(traded).toBe(false);
});

test("Hyperliquid not answering shows unavailable, never a number", async ({ page }) => {
  await signIn(page);
  await edge("/__state", { down: ["hyperliquid"] });
  await page.goto("/app/perps");
  await expect(page.getByTestId("perps-markets-unavailable")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("perps-account-value")).toHaveText("Unavailable");
  await expect(page.getByTestId("perps-available")).toHaveText("Unavailable");
  await expect(page.getByTestId("perps-withdrawable")).toHaveText("Unavailable");
});

test("on the phone, nothing on the Perps pages sits under the menu button", async ({ page }, info) => {
  test.skip(!isPhone(info), "The menu button is the phone's.");
  await signIn(page);
  for (const path of ["/app/perps", "/app/perps/BTC"]) {
    await page.goto(path);
    await expect(page.locator(".mkPage")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(500);
    await expect.poll(() => page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const menu = document.querySelector(".appMenuButton")!.getBoundingClientRect();
      return [...document.querySelectorAll("main a[href], main button, main input")]
        .map((el) => ({ name: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim(), box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.bottom > menu.top && box.top < menu.bottom && box.right > menu.left && box.left < menu.right)
        .map(({ name }) => name);
    }), { message: path, timeout: 10_000 }).toEqual([]);
  }
});
