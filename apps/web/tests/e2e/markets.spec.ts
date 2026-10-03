import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page, Route, TestInfo } from "@playwright/test";
import { perpPosition, predictionPosition } from "./support/fake-markets.mjs";
import { expect, test } from "./support/fixtures";
import { acceptTerms, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer } from "./support/session";

// Markets: perps on Hyperliquid and predictions on Polymarket. Hyperliquid's
// and Polymarket's read APIs are the local fake (support/fake-markets.mjs), so
// every screen reads through Aura's real routes, switches, and D1. Placing a
// trade needs signatures the venues verify, so the trade specs stub Aura's own
// write routes in the browser and check the screen drives them in order: add
// money through the action flow, connect with the passkey, then place.

const flow = (page: Page) => page.locator(".mkFlow");
const sheet = (page: Page) => page.getByRole("dialog");
const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");

/** Screenshots for design review, when MARKETS_SCREENSHOTS names a folder. */
async function shot(page: Page, info: TestInfo, name: string) {
  const dir = process.env.MARKETS_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, `${name}-${isPhone(info) ? "phone" : "desktop"}.png`), fullPage: !(await sheet(page).isVisible()) });
}

async function signIn(page: Page, usdc = "250000000"): Promise<Customer> {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: usdc } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  return customer;
}

/** Type a dollar amount: the keypad on the phone, the field on desktop. */
async function enterAmount(page: Page, info: TestInfo, amount: string) {
  if (isPhone(info)) {
    const keypad = sheet(page).getByRole("group", { name: "Keypad" });
    for (const key of amount) await keypad.getByRole("button", { name: key, exact: true }).click();
  } else {
    await sheet(page).getByRole("textbox", { name: "Amount" }).fill(amount);
  }
}

const observed = <T>(source: "hyperliquid" | "polymarket", data: T) => ({ status: "observed", source, observedAt: new Date().toISOString(), data });
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const signRequest = { version: 1, method: "POST", url: "http://127.0.0.1/privy/v1/wallets/w/rpc", body: {}, headers: {} };
const requestId = "8a6f0f8e-1d2b-4c3d-9e4f-5a6b7c8d9e0f";

/** A deposit action as Aura's action flow sees it, settling on the first status read. */
async function stubDepositAction(page: Page, id: string, final: { status: "confirmed" | "failed"; destinationChainId: number | null }) {
  const action = (status: string) => ({ id, kind: final.destinationChainId ? "route" : "transfer", chainId: 8453, status, summary: {}, calls: [{ to: ASSETS.usdc, value: "0", data: "0x" }],
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
  for (const path of ["/app/markets", "/app/markets/perps/BTC", "/app/markets/predictions/5001"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("guests see labelled example perps and predictions, and trading asks them to sign in", async ({ page }, info) => {
  await page.goto("/app/markets");
  await expect(page.getByRole("heading", { name: "Markets", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("note")).toContainText("Example data");
  await expect(page.getByTestId("perps-account-value")).toHaveText("$1,286.40");
  await expect(page.getByRole("list", { name: "Perp markets" }).getByRole("link", { name: /^SPCX/ })).toBeVisible();
  await expect(page.getByText("Example data, shaped like Hyperliquid's").first()).toBeVisible();
  await shot(page, info, "guest-perps");
  await page.getByRole("radio", { name: "Predictions" }).click();
  await expect(page).toHaveURL(/view=predictions/);
  await expect(page.getByRole("article", { name: /transit budget by March\? \(example\)/ })).toBeVisible();
});

test("with the switches off, each tab says it isn't available yet", async ({ page }) => {
  await setFeature(page, "perps", false);
  await setFeature(page, "predictions", false);
  await signIn(page);
  await page.goto("/app/markets");
  await expect(page.getByRole("heading", { name: "Perps aren't available yet" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("perps-account-value")).toHaveCount(0);
  await page.getByRole("radio", { name: "Predictions" }).click();
  await expect(page.getByRole("heading", { name: "Predictions aren't available yet" })).toBeVisible({ timeout: 20_000 });
});

test("perps home: the account, positions, orders, and history from Hyperliquid, and markets with search", async ({ page }, info) => {
  const customer = await signIn(page);
  await edge("/__markets", { hyperliquid: { [customer.wallet]: {
    accountValue: "1286.40", withdrawable: "965.10",
    positions: [perpPosition({ coin: "BTC", size: "0.05", entryPx: "62900.0", positionValue: "3212.50", unrealizedPnl: "67.50", marginUsed: "321.25", liquidationPx: "50820.0" })],
    orders: [{ coin: "ETH", side: "B", limitPx: "2950.0", sz: "0.2", origSz: "0.2", oid: 77, timestamp: Date.now() - 60_000, orderType: "Limit", reduceOnly: false,
      isTrigger: false, triggerPx: "0.0", isPositionTpsl: false, tif: "Gtc" }],
    fills: [{ coin: "BTC", px: "62900.0", sz: "0.05", side: "B", time: Date.now() - 86_400_000, dir: "Open Long", closedPnl: "0.0", fee: "1.41", feeToken: "USDC",
      oid: 70, tid: 1, hash: `0x${"0".repeat(63)}1` }]
  } } });
  await page.goto("/app/markets");
  await expect(page.getByTestId("perps-account-value")).toHaveText("$1,286.40", { timeout: 30_000 });
  await expect(page.getByTestId("perps-available")).toHaveText("$965.10");
  await expect(page.getByText(/^From Hyperliquid at /).first()).toBeVisible();
  const position = page.getByRole("listitem", { name: "BTC long" });
  await expect(position).toContainText("Long 10x");
  await expect(position).toContainText("+$67.50");
  await page.getByRole("tab", { name: /Orders/ }).click();
  await expect(page.getByText("Buy ETH")).toBeVisible();
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText("Open Long BTC")).toBeVisible();
  await page.getByRole("tab", { name: /Positions/ }).click();

  const markets = page.getByRole("list", { name: "Perp markets" });
  await expect(markets.getByRole("link")).toHaveCount(5);
  // A stock perp shows its name without the dex prefix, with its max leverage.
  await expect(markets.getByRole("link", { name: /^SPCX 10x/ })).toContainText("Stock perp");
  await expect(markets).not.toContainText("xyz:");
  await expect(markets.getByRole("link", { name: /^BTC 40x/ })).toContainText("$64,250.00");
  await expect(markets.getByRole("link", { name: /^BTC 40x/ })).toContainText("+1.81%");
  await shot(page, info, "perps-home");
  await page.getByPlaceholder("Search markets").fill("nvd");
  await expect(markets.getByRole("link")).toHaveCount(1);
  await expect(markets.getByRole("link")).toContainText("NVDA");
});

test("a perps market page: price, about, your position, and an order sheet priced by the server", async ({ page }, info) => {
  const customer = await signIn(page);
  await edge("/__markets", { hyperliquid: { [customer.wallet]: { accountValue: "500", withdrawable: "500" } } });
  await page.goto("/app/markets/perps/BTC");
  await expect(page.getByTestId("perps-market-price")).toHaveText("$64,250.00", { timeout: 30_000 });
  const about = page.getByRole("region", { name: "About" });
  await expect(about).toContainText("Open interest");
  await expect(about).toContainText(/Funding, hourly\+0\.001\d%/);
  await expect(about).toContainText("Max leverage40x");
  await expect(page.getByText("No open positions.")).toBeVisible();
  await shot(page, info, "perps-market");

  await page.getByRole("button", { name: "Long", exact: true }).click();
  await expect(sheet(page).getByRole("heading", { name: "Long BTC" })).toBeVisible();
  await enterAmount(page, info, "20");
  await sheet(page).getByRole("radio", { name: "Isolated" }).click();
  // Isolated at 5x: the server's estimate, 64,250 × (1 − 1/5 × …).
  await expect(sheet(page).getByTestId("perps-liquidation")).toHaveText(/^\$5\d,\d{3}\.\d{2}$/, { timeout: 20_000 });
  await expect(sheet(page)).toContainText("Position size$");
  await shot(page, info, "perps-order-sheet");
  await sheet(page).getByText("Auto-close").click();
  await expect(sheet(page).getByLabel("Take profit at")).toBeVisible();
  await sheet(page).getByRole("button", { name: "Close" }).first().click();

  // A stock perp: its page uses the name without the dex.
  await page.goto(`/app/markets/perps/${encodeURIComponent("xyz:SPCX")}`);
  await expect(page.getByRole("heading", { name: "SPCX", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("A stock perp on the xyz market")).toBeVisible();
});

test("one tap opens a long: adds money through the action flow, connects with the passkey, then places the order", async ({ page }, info) => {
  await signIn(page);
  let connected = false, funded = false;
  const calls: string[] = [];
  await page.route("**/api/perps/account", async (route) => {
    const state = { dex: "", accountValue: funded ? "20" : "0", totalMarginUsed: "0", withdrawable: funded ? "20" : "0", crossAccountValue: "0", crossMaintenanceMarginUsed: "0", positions: [], time: Date.now() };
    await json(route, { owner: "0x1", connection: connected ? { status: "ready", tradingKey: "0x1", approvedAt: new Date().toISOString() } : null,
      state: observed("hyperliquid", state), dexStates: observed("hyperliquid", [state]), orders: observed("hyperliquid", []), fills: observed("hyperliquid", []) });
  });
  const deposit = await stubDepositAction(page, "perps-deposit-1", { status: "confirmed", destinationChainId: 1337 });
  await page.route("**/api/perps/deposit", async (route) => { calls.push(`deposit ${route.request().postDataJSON().amount}`); funded = true; await json(route, { action: deposit }, 201); });
  await page.route("**/api/perps/setup", async (route) => { calls.push("setup"); await json(route, { status: "sign", requestId, request: signRequest }); });
  await page.route("**/api/perps/signatures", async (route) => { calls.push("signatures"); connected = true; await json(route, { status: "accepted", kind: "setup" }); });
  await page.route("**/api/perps/trade", async (route) => {
    calls.push(`trade ${JSON.stringify(route.request().postDataJSON())}`);
    await json(route, { statuses: [{ kind: "filled", oid: 9, totalSz: "0.0015", avgPx: "64250.0" }], size: "0.0015", margin: "20", notional: "96.37", liquidationPrice: null }, 201);
  });

  await page.goto("/app/markets/perps/BTC");
  await page.getByRole("button", { name: "Long", exact: true }).click({ timeout: 30_000 });
  await enterAmount(page, info, "15");
  await expect(sheet(page)).toContainText("Added from USDC first$16.00", { timeout: 20_000 });
  await sheet(page).getByRole("button", { name: "Open long" }).click();
  await expect(flow(page)).toContainText("Order placed. 0.0015 BTC at $64,250.00.", { timeout: 30_000 });
  await shot(page, info, "perps-order-placed");
  expect(calls).toEqual(["deposit 16.00", "setup", "signatures",
    `trade ${JSON.stringify({ coin: "BTC", side: "long", marginUsd: "15.00", leverage: 5, isCross: true, type: "market" })}`]);
});

test("a cancelled passkey stops the trade and says so", async ({ page }, info) => {
  await signIn(page);
  await page.addInitScript(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  let traded = false;
  await page.route("**/api/perps/setup", (route) => json(route, { status: "sign", requestId, request: signRequest }));
  await page.route("**/api/perps/trade", async (route) => { traded = true; await json(route, { statuses: [] }, 201); });
  await page.route("**/api/perps/account", async (route) => {
    const state = { dex: "", accountValue: "100", totalMarginUsed: "0", withdrawable: "100", crossAccountValue: "100", crossMaintenanceMarginUsed: "0", positions: [], time: Date.now() };
    await json(route, { owner: "0x1", connection: null, state: observed("hyperliquid", state), dexStates: observed("hyperliquid", [state]), orders: observed("hyperliquid", []), fills: observed("hyperliquid", []) });
  });
  await page.goto("/app/markets/perps/ETH");
  await page.getByRole("button", { name: "Short", exact: true }).click({ timeout: 30_000 });
  await enterAmount(page, info, "10");
  await sheet(page).getByRole("button", { name: "Open short" }).click();
  await expect(flow(page)).toContainText("You cancelled. Nothing more was sent.", { timeout: 20_000 });
  expect(traded).toBe(false);
});

test("Hyperliquid not answering shows unavailable, never a number", async ({ page }) => {
  await signIn(page);
  await edge("/__state", { down: ["hyperliquid"] });
  await page.goto("/app/markets");
  await expect(page.getByTestId("perps-markets-unavailable")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("perps-account-value")).toHaveText("Unavailable");
  await expect(page.getByTestId("perps-available")).toHaveText("Unavailable");
});

test("predictions home: categories, events with each outcome's chance, Up or Down, and no sports", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/app/markets?view=predictions");
  const transit = page.getByRole("article", { name: "Will the transit budget pass by March?" });
  await expect(transit).toBeVisible({ timeout: 30_000 });
  await expect(transit.getByRole("link", { name: /^Yes\s*63%$/ })).toBeVisible();
  await expect(transit.getByRole("link", { name: /^No\s*37%$/ })).toBeVisible();
  await expect(page.getByRole("article", { name: "Rate decision in June" })).toContainText("Rates unchanged in June?52%");
  await expect(page.getByText("cup final")).toHaveCount(0);
  const categories = page.getByRole("group", { name: "Categories" });
  await expect(categories.getByRole("button")).toHaveText(["All", "Up or Down", "Politics", "Economy", "Crypto", "Tech", "Culture"]);
  await shot(page, info, "predictions-home");
  await categories.getByRole("button", { name: "Economy" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Rate decision in June" })).toBeVisible();
  await categories.getByRole("button", { name: "Up or Down" }).click();
  const bitcoin = page.getByRole("article", { name: /Bitcoin Up or Down/ });
  await expect(bitcoin).toContainText("Price to beat $64,210.50", { timeout: 20_000 });
  await expect(bitcoin.getByRole("link", { name: /^Up\s*54%$/ })).toBeVisible();
});

test("a prediction market page: the odds chart, what decides it, and a buy that sets up, adds money, and signs the order", async ({ page }, info) => {
  await signIn(page);
  let stage: "new" | "approved" | "ready" = "new";
  let pusd = 0;
  const calls: string[] = [];
  await page.route("**/api/predictions/account", async (route) => {
    await json(route, { owner: "0x1", connection: stage === "ready" ? { status: "ready", wallet: "0x1", approvedAt: null } : null,
      balance: observed("polymarket", { raw: String(pusd * 1e6), amount: String(pusd) }), positions: observed("polymarket", []), orders: null });
  });
  await page.route("**/api/predictions/setup", async (route) => {
    calls.push(`setup ${stage}`);
    if (stage === "new") return json(route, { status: "sign", requestId, request: signRequest });
    stage = "ready";
    return json(route, { status: "ready", wallet: "0x1" });
  });
  await page.route("**/api/predictions/signatures", async (route) => {
    calls.push("signatures");
    if (stage === "new") { stage = "approved"; return json(route, { status: "submitted", kind: "setup", transactionId: "t1" }); }
    return json(route, { status: "accepted", kind: "order", order: { orderId: "0x1", status: "matched", makingAmount: "10", takingAmount: "15.38", tradeIds: [] } });
  });
  const deposit = await stubDepositAction(page, "predictions-deposit-1", { status: "confirmed", destinationChainId: null });
  await page.route("**/api/predictions/deposit", async (route) => { calls.push(`deposit ${route.request().postDataJSON().amount}`); pusd = 10; await json(route, { action: deposit }, 201); });
  await page.route("**/api/predictions/orders/buy", async (route) => {
    calls.push(`buy ${JSON.stringify(route.request().postDataJSON())}`);
    await json(route, { status: "sign", requestId, request: signRequest, quote: { amount: 10, estimatedShares: 15.38, payoutIfWins: 15.38, minimumPayoutIfWins: 15.2, averagePrice: 0.65 } });
  });

  await page.goto("/app/markets/predictions/5001");
  await expect(page.getByRole("heading", { name: "Will the transit budget pass by March?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("prediction-chance")).toHaveText("63%");
  await expect(page.getByRole("img", { name: /Yes chance from/ })).toBeVisible();
  const about = page.getByRole("region", { name: "About" });
  await expect(about).toContainText("Volume$2.5M");
  await expect(about.getByRole("link", { name: "example.com" })).toHaveAttribute("href", "https://www.example.com/results");
  await shot(page, info, "prediction-market");

  await page.getByRole("button", { name: /^Buy Yes 64¢$/ }).click();
  await enterAmount(page, info, "10");
  await expect(sheet(page).getByTestId("prediction-payout")).toContainText("$10.00 → $15.63 if Yes wins");
  // No fee line: Aura takes no fee.
  await expect(sheet(page)).not.toContainText("Fee");
  await shot(page, info, "prediction-trade-sheet");
  await sheet(page).getByRole("button", { name: "Buy Yes" }).click();
  await expect(flow(page)).toContainText("Order placed. You bought Yes.", { timeout: 40_000 });
  await expect(sheet(page)).toContainText("If Yes wins$15.38");
  await shot(page, info, "prediction-order-placed");
  expect(calls).toEqual(["setup new", "signatures", "setup approved", "deposit 10.00",
    `buy ${JSON.stringify({ marketId: "5001", outcome: 0, amountUsd: 10 })}`, "signatures"]);
});

test("a position opens its market by slug, with its value, profit, and Sell", async ({ page }) => {
  await signIn(page);
  await edge("/__markets", { positions: [predictionPosition({ id: 5004, title: "Will ether close the year above $4,000?", size: 50, avgPrice: 0.3, currentPrice: 0.37 })] });
  await page.goto("/app/markets?view=predictions");
  const positions = page.getByRole("list", { name: "Your prediction positions" });
  await expect(positions).toContainText("$18.50", { timeout: 30_000 });
  await expect(positions).toContainText("+$3.50");
  await positions.getByRole("link").click();
  await expect(page).toHaveURL(/\/app\/markets\/predictions\/market-5004$/);
  await expect(page.getByRole("heading", { name: "Will ether close the year above $4,000?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Your position" }).getByRole("button", { name: "Sell" })).toBeVisible();
});

test("Polymarket not answering shows unavailable", async ({ page }) => {
  await signIn(page);
  await edge("/__state", { down: ["polymarket"] });
  await page.goto("/app/markets?view=predictions");
  await expect(page.getByTestId("predictions-unavailable")).toBeVisible({ timeout: 30_000 });
  // Cash is read from Polygon, which still answers; positions come from Polymarket, so the total can't be shown.
  await expect(page.getByTestId("predictions-value")).toHaveText("Unavailable");
  await expect(page.getByText("We couldn't read your positions from Polymarket.")).toBeVisible();
});

test("on the phone, nothing on the Markets pages sits under the menu button", async ({ page }, info) => {
  test.skip(!isPhone(info), "The menu button is the phone's.");
  await signIn(page);
  for (const path of ["/app/markets", "/app/markets?view=predictions", "/app/markets/perps/BTC", "/app/markets/predictions/5001"]) {
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
