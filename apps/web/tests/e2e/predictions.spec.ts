import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page, Route, TestInfo } from "@playwright/test";
import { predictionPosition } from "./support/fake-markets.mjs";
import { expect, test } from "./support/fixtures";
import { acceptTerms, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer } from "./support/session";

// Predictions on Polymarket. Polymarket's read APIs are the local fake
// (support/fake-markets.mjs), so every screen reads through Aura's real
// routes, switches, and D1. Placing a trade needs signatures Polymarket
// verifies, so the trade specs stub Aura's own write routes in the browser and
// check the screen drives them in order. The live Up or Down price comes from
// Polymarket's price socket, which these specs answer in the browser.

const flow = (page: Page) => page.locator(".mkFlow");
const sheet = (page: Page) => page.getByRole("dialog");
const isPhone = (info: TestInfo) => info.project.name.startsWith("mobile");
const panel = (page: Page) => page.getByRole("complementary", { name: "Trade" });

/** Screenshots for design review, when PREDICTIONS_SCREENSHOTS names a folder. */
async function shot(page: Page, info: TestInfo, name: string, suffix = "") {
  const dir = process.env.PREDICTIONS_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const open = await sheet(page).isVisible();
  if (!open) await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(dir, `${name}-${isPhone(info) ? "phone" : "desktop"}${suffix}.png`), fullPage: !open });
}

async function darkShot(page: Page, info: TestInfo, name: string) {
  if (isPhone(info)) return;
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await shot(page, info, name, "-dark");
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
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

/** The order form for an outcome: the panel beside the chart on desktop; the sheet that Buy opens under the chart on the phone. */
async function openTrade(page: Page, info: TestInfo, outcome: string, side: "Buy" | "Sell" = "Buy"): Promise<Locator> {
  if (isPhone(info)) {
    await page.getByRole("button", { name: new RegExp(`^Buy ${outcome} `) }).click({ timeout: 30_000 });
    await expect(sheet(page).getByRole("heading", { name: "Buy" })).toBeVisible();
    if (side === "Sell") await sheet(page).getByRole("radio", { name: "Sell", exact: true }).click();
    return sheet(page);
  }
  const form = panel(page);
  await form.getByRole("radio", { name: side, exact: true }).click({ timeout: 30_000 });
  await form.getByRole("radio", { name: new RegExp(`^${outcome} `) }).click();
  return form;
}

const observed = <T>(data: T) => ({ status: "observed", source: "polymarket", observedAt: new Date().toISOString(), data });
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const signRequest = { version: 1, method: "POST", url: "http://127.0.0.1/privy/v1/wallets/w/rpc", body: {}, headers: {} };
const requestId = "8a6f0f8e-1d2b-4c3d-9e4f-5a6b7c8d9e0f";

/** A deposit action as Aura's action flow sees it, settling on the first status read. */
async function stubDepositAction(page: Page, id: string) {
  const action = (status: string) => ({ id, kind: "transfer", chainId: 8453, status, summary: {}, calls: [{ to: ASSETS.usdc, value: "0", data: "0x" }],
    usdCents: 1000, transactionHash: `0x${"ab".repeat(32)}`, destinationChainId: null, destinationTransactionHash: null, failureReason: null, createdAt: new Date().toISOString() });
  await page.route(`**/api/actions/${id}/authorize`, (route) => json(route, { request: signRequest }));
  await page.route(`**/api/actions/${id}/submit`, (route) => json(route, { action: action("submitted") }));
  await page.route(`**/api/actions/${id}`, (route) => json(route, { action: action("confirmed") }));
  return action("prepared");
}

/**
 * Polymarket's live price socket, answered in the browser: the last minute of
 * Chainlink BTC/USD on subscribing, then a tick every half second.
 */
async function streamBitcoin(page: Page, price = 64250.25) {
  await page.routeWebSocket(/ws-live-data\.polymarket\.com/, (socket) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    socket.onMessage((message) => {
      const text = String(message);
      if (text === "PING") return socket.send("PONG");
      const subscription = JSON.parse(text) as { action: string; subscriptions: Array<{ topic: string; filters: string }> };
      expect(subscription.subscriptions[0]).toMatchObject({ topic: "crypto_prices_chainlink", filters: "{\"symbol\":\"btc/usd\"}" });
      const now = Math.floor(Date.now() / 1000) * 1000;
      socket.send(JSON.stringify({ topic: "crypto_prices", type: "subscribe", payload: { symbol: "btc/usd",
        data: Array.from({ length: 60 }, (_, index) => ({ timestamp: now - (60 - index) * 1000, value: price - 30 + index * 0.5 })) } }));
      let tick = 0;
      timer = setInterval(() => {
        tick += 1;
        socket.send(JSON.stringify({ topic: "crypto_prices_chainlink", type: "update", payload: { symbol: "btc/usd", timestamp: now + tick * 1000, value: price } }));
        if (tick > 120) clearInterval(timer);
      }, 500);
    });
    socket.onClose(() => clearInterval(timer));
  });
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "predictions", true);
});

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app/predictions", "/app/predictions/5001", "/app/predictions/6001"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("predictions home: categories, search, events with each outcome's chance, Up or Down with time left, and no sports", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/app/predictions");
  const transit = page.getByRole("article", { name: "Will the transit budget pass by March?" });
  await expect(transit).toBeVisible({ timeout: 30_000 });
  await expect(transit.getByRole("link", { name: /^Yes\s*63%$/ })).toBeVisible();
  await expect(transit.getByRole("link", { name: /^No\s*37%$/ })).toBeVisible();
  await expect(transit).toContainText("$5.1M volume");
  await expect(page.getByRole("article", { name: "Rate decision in June" })).toContainText("Rates unchanged in June?52%");
  await expect(page.getByText("cup final")).toHaveCount(0);
  await expect(page.getByText("bridge reopen")).toHaveCount(0);
  const categories = page.getByRole("group", { name: "Categories" });
  await expect(categories.getByRole("button")).toHaveText(["All", "Up or Down", "Politics", "Economy", "Crypto", "Tech", "Culture"]);
  await expect(page.getByText("No positions yet. Pick a market below.")).toBeVisible();
  await shot(page, info, "predictions-home");

  // Search asks Polymarket for matching titles.
  const searches: string[] = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname === "/api/predictions/events" && url.searchParams.get("search")) searches.push(url.searchParams.get("search")!); });
  await page.getByRole("searchbox", { name: "Search markets" }).fill("ether");
  await expect.poll(() => searches.at(-1)).toBe("ether");
  await page.getByRole("searchbox", { name: "Search markets" }).fill("");

  await categories.getByRole("button", { name: "Economy" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article", { name: "Rate decision in June" })).toBeVisible();
  await categories.getByRole("button", { name: "Up or Down" }).click();
  const bitcoin = page.getByRole("article", { name: /Bitcoin Up or Down/ });
  await expect(bitcoin).toContainText("Price to beat $64,210.50", { timeout: 20_000 });
  await expect(bitcoin).toContainText(/Ends in \d+:\d{2}/);
  await expect(bitcoin).toContainText("15 min");
  await expect(bitcoin.getByRole("link", { name: /^Up\s*54%$/ })).toBeVisible();
  await expect(page.getByRole("group", { name: "Window" }).getByRole("button")).toHaveText(["Any length", "5 min", "15 min", "1 hour", "4 hours", "Daily"]);
});

test("a market page: the odds chart and its ranges, the order panel beside it (a sheet on the phone), and a buy that sets up in steps, adds money, and signs", async ({ page }, info) => {
  await signIn(page);
  let stage: "new" | "approved" | "ready" = "new";
  let pusd = 0;
  const calls: string[] = [];
  const ranges: string[] = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname === "/api/predictions/history") ranges.push(url.searchParams.get("interval") ?? ""); });
  await page.route("**/api/predictions/account", async (route) => {
    await json(route, { owner: "0x1", connection: stage === "ready" ? { status: "ready", wallet: "0x1", approvedAt: null } : null,
      balance: observed({ raw: String(pusd * 1e6), amount: String(pusd) }), positions: observed([]), orders: null });
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
  const deposit = await stubDepositAction(page, "predictions-deposit-1");
  await page.route("**/api/predictions/deposit", async (route) => { calls.push(`deposit ${route.request().postDataJSON().amount}`); pusd = 10; await json(route, { action: deposit }, 201); });
  await page.route("**/api/predictions/orders/buy", async (route) => {
    calls.push(`buy ${JSON.stringify(route.request().postDataJSON())}`);
    await json(route, { status: "sign", requestId, request: signRequest, quote: { amount: 10, estimatedShares: 15.38, payoutIfWins: 15.38, minimumPayoutIfWins: 15.2, averagePrice: 0.65 } });
  });

  await page.goto("/app/predictions/5001");
  await expect(page.getByRole("heading", { name: "Will the transit budget pass by March?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("prediction-chance")).toHaveText("63%");
  await expect(page.getByRole("img", { name: /Yes chance from/ })).toBeVisible();
  await expect(page.getByText(/^Was \d+% a week ago$/)).toBeVisible();
  const periods = page.getByRole("radiogroup", { name: "Chart period" });
  await expect(periods.getByRole("radio")).toHaveText(["1H", "6H", "1D", "1W", "1M", "All"]);
  await periods.getByRole("radio", { name: "1D" }).click();
  await expect.poll(() => ranges.includes("1d")).toBe(true);
  const about = page.getByRole("region", { name: "About" });
  await expect(about).toContainText("Volume$2.5M");
  await expect(about.getByRole("link", { name: "example.com" })).toHaveAttribute("href", "https://www.example.com/results");
  await expect(page.getByRole("img", { name: /Yes chance from/ })).toBeVisible();
  if (isPhone(info)) await expect(panel(page)).toHaveCount(0);
  else await expect(panel(page).getByRole("radio", { name: /^Yes 64¢$/ })).toHaveAttribute("aria-checked", "true");
  await shot(page, info, "prediction-market");
  await darkShot(page, info, "prediction-market");

  const form = await openTrade(page, info, "Yes");
  // Only a valid amount stays in the field.
  if (!isPhone(info)) {
    await form.getByRole("textbox", { name: /^Amount/ }).fill("1.2.3");
    await expect(form.getByRole("textbox", { name: /^Amount/ })).toHaveValue("1.23");
    await form.getByRole("textbox", { name: /^Amount/ }).fill("");
    await form.getByRole("button", { name: "+$20" }).click();
    await expect(form.getByRole("textbox", { name: /^Amount/ })).toHaveValue("20");
    await form.getByRole("textbox", { name: /^Amount/ }).fill("");
  } else {
    await enterAmount(form, info, "1..");
    await expect(form.getByRole("textbox", { name: /^Amount/ })).toHaveValue("1.");
    for (let i = 0; i < 2; i += 1) await form.getByRole("group", { name: "Keypad" }).getByRole("button", { name: "Delete" }).click();
  }
  await expect(form.getByRole("group", { name: "Amount shortcuts" }).getByRole("button")).toHaveText(["+$1", "+$20", "+$100", "Max"]);
  await enterAmount(form, info, "10");
  await expect(form.getByTestId("prediction-payout")).toHaveText("To win$15.63");
  await expect(form).toContainText("Shares");
  await expect(form).toContainText("$10.00 from your USDC, then cash");
  // What the buy can spend, under where it's paid from: no predictions account yet, so only the USDC on Base.
  await expect(form.getByTestId("prediction-available")).toHaveText("$250.00 USDC on Base available");
  await expect(form).toContainText("Your first buy sets up your predictions account");
  // No fee line: Aura takes no fee.
  await expect(form).not.toContainText("Fee");
  await shot(page, info, "prediction-trade-sheet");
  await form.getByRole("button", { name: "Buy Yes" }).click();
  await expect(flow(page)).toContainText("Create your predictions account");
  await expect(flow(page)).toContainText("Allow it to trade");
  await expect(flow(page)).toContainText("Order placed. You bought 15.38 Yes shares for $10.00.", { timeout: 40_000 });
  await expect(form).toContainText("If Yes wins$15.38");
  await shot(page, info, "prediction-order-placed");
  expect(calls).toEqual(["setup new", "signatures", "setup approved", "deposit 10.00",
    `buy ${JSON.stringify({ marketId: "5001", outcome: 0, amountUsd: 10 })}`, "signatures"]);
});

test("an Up or Down market: the live price streamed from Polymarket, the price to beat, and the time left", async ({ page }, info) => {
  await signIn(page);
  await streamBitcoin(page);
  await page.goto("/app/predictions/6001");
  await expect(page.getByRole("heading", { name: "Bitcoin Up or Down - 3:00PM-3:15PM ET" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("prediction-price-to-beat")).toHaveText("$64,210.50", { timeout: 20_000 });
  await expect(page.getByTestId("prediction-current-price")).toHaveText("$64,250.25 ▲ $39.75", { timeout: 20_000 });
  await expect(page.getByTestId("prediction-time-left")).toHaveText(/^\d{1,2}:\d{2}$/);
  const chart = page.getByTestId("prediction-live-chart");
  await expect(chart.getByRole("img", { name: "Bitcoin price, live: $64,250.25, at or above the price to beat of $64,210.50" })).toBeVisible();
  await expect(chart).toContainText("Price to beat");
  await expect(page.getByText(/^Live from Chainlink, through Polymarket, at /)).toBeVisible();
  await expect(page.getByRole("region", { name: "About" })).toContainText("Up wins if Bitcoin's price for this window, as Chainlink reports it, ends at or above the price to beat.");
  if (!isPhone(info)) await expect(panel(page).getByRole("radio", { name: /^Up / })).toBeVisible();
  else await expect(page.getByRole("button", { name: /^Buy Down / })).toBeVisible();
  await shot(page, info, "prediction-up-or-down");
  await darkShot(page, info, "prediction-up-or-down");
});

test("the live price shows as unavailable when the stream can't be reached", async ({ page }) => {
  test.setTimeout(60_000);
  await signIn(page);
  await page.routeWebSocket(/ws-live-data\.polymarket\.com/, (socket) => socket.close());
  await page.goto("/app/predictions/6001");
  await expect(page.getByTestId("prediction-price-to-beat")).toHaveText("$64,210.50", { timeout: 30_000 });
  await expect(page.getByTestId("prediction-live-unavailable")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId("prediction-current-price")).toHaveText("Unavailable");
});

test("positions: sell shares from the order form, and collect a market that was won", async ({ page }, info) => {
  test.setTimeout(90_000);
  await signIn(page);
  await edge("/__markets", { positions: [
    predictionPosition({ id: 5004, title: "Will ether close the year above $4,000?", size: 50, avgPrice: 0.3, currentPrice: 0.37 }),
    predictionPosition({ id: 5006, title: "Will the bridge reopen by June?", outcomeIndex: 1, size: 30, avgPrice: 0.6, currentPrice: 1, redeemable: true })
  ] });
  const calls: string[] = [];
  await page.route("**/api/predictions/orders/sell", async (route) => { calls.push(`sell ${JSON.stringify(route.request().postDataJSON())}`); await json(route, { status: "sign", requestId, request: signRequest }); });
  await page.route("**/api/predictions/redeem", async (route) => { calls.push(`redeem ${JSON.stringify(route.request().postDataJSON())}`); await json(route, { status: "sign", requestId, request: signRequest }); });
  await page.route("**/api/predictions/signatures", async (route) => {
    calls.push("signatures");
    const selling = calls.some((call) => call.startsWith("sell")) && !calls.some((call) => call.startsWith("redeem"));
    await json(route, selling ? { status: "accepted", kind: "order", order: { orderId: "0x2", status: "matched", makingAmount: "50", takingAmount: "17.95", tradeIds: [] } }
      : { status: "submitted", kind: "redeem", transactionId: "t2" });
  });

  // The home lists both: one to sell, one won and ready to collect.
  await page.goto("/app/predictions");
  const positions = page.getByRole("list", { name: "Your prediction positions" });
  await expect(positions).toContainText("$18.50", { timeout: 30_000 });
  await expect(positions).toContainText("+$3.50");
  await expect(positions.getByRole("listitem", { name: /bridge reopen.*No/ })).toContainText("Won");
  await expect(positions.getByRole("listitem", { name: /bridge reopen/ }).getByRole("button", { name: "Collect" })).toBeVisible();
  await expect(positions.getByRole("listitem", { name: /ether close/ }).getByRole("button", { name: "Sell" })).toBeVisible();
  await shot(page, info, "prediction-positions");

  // Sell from the market's order form.
  await positions.getByRole("link", { name: /ether close/ }).click();
  await expect(page).toHaveURL(/\/app\/predictions\/market-5004$/);
  await expect(page.getByRole("heading", { name: "Will ether close the year above $4,000?" })).toBeVisible({ timeout: 30_000 });
  const position = page.getByRole("region", { name: "Your position" });
  await position.getByRole("button", { name: "Sell" }).click();
  const form = isPhone(info) ? sheet(page) : panel(page);
  await expect(form.getByRole("radio", { name: "Sell", exact: true })).toHaveAttribute("aria-checked", "true");
  await form.getByRole("button", { name: "Max" }).click();
  await expect(form.getByLabel("Shares")).toHaveValue("50");
  await expect(form.getByTestId("prediction-sell-receive")).toHaveText("About $18.00");
  await expect(form).toContainText("At least $17.50");
  await form.getByLabel("Shares").fill("60");
  await expect(form).toContainText("You hold 50 Yes shares.");
  await form.getByRole("button", { name: "Max" }).click();
  await shot(page, info, "prediction-sell");
  await form.getByRole("button", { name: "Sell Yes" }).click();
  await expect(flow(page)).toContainText("Sold 50 Yes shares for $17.95. It's in your predictions cash.", { timeout: 20_000 });
  await form.getByRole("button", { name: "Done" }).click();

  // Collect a won market from its page: trading has ended and No won.
  await page.goto("/app/predictions/5006");
  await expect(page.getByRole("heading", { name: "Will the bridge reopen by June?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("prediction-trading-ended")).toContainText("No won.");
  await page.getByRole("region", { name: "Your position" }).getByRole("button", { name: "Collect $30.00" }).click();
  await expect(sheet(page).getByTestId("prediction-collect-amount")).toHaveText("$30.00");
  await shot(page, info, "prediction-collect");
  await sheet(page).getByRole("button", { name: "Collect $30.00" }).click();
  await expect(flow(page)).toContainText("Collecting $30.00. It reaches your predictions cash in about a minute.", { timeout: 20_000 });
  expect(calls).toEqual([`sell ${JSON.stringify({ marketId: "5004", outcome: 0, shares: 50 })}`, "signatures", `redeem ${JSON.stringify({ marketId: "5006" })}`, "signatures"]);
});

test("a setup that was left part way says so, and finishes in steps", async ({ page }) => {
  await signIn(page);
  let ready = false;
  await page.route("**/api/predictions/account", (route) => json(route, { owner: "0x1",
    connection: { status: ready ? "ready" : "pending", wallet: "0x1", approvedAt: null }, balance: observed({ raw: "0", amount: "0" }), positions: observed([]), orders: null }));
  await page.route("**/api/predictions/setup", async (route) => {
    if (!ready) { ready = true; return json(route, { status: "sign", requestId, request: { ...signRequest, body: { params: { typed_data: { primary_type: "ClobAuth" } } } } }); }
    return json(route, { status: "ready", wallet: "0x1" });
  });
  await page.route("**/api/predictions/signatures", (route) => json(route, { status: "accepted", kind: "setup" }));
  await page.goto("/app/predictions");
  await expect(page.getByTestId("predictions-setup-pending")).toContainText("isn't finished", { timeout: 30_000 });
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(sheet(page).getByRole("listitem")).toHaveText([/Create your predictions account/, /Allow it to trade/, /Connect it to Polymarket/]);
  await sheet(page).getByRole("button", { name: "Continue setup" }).click();
  await expect(flow(page)).toContainText("Your predictions account is ready.", { timeout: 20_000 });
});

test("Polygon not answering: cash shows as unavailable and setup says why in plain words", async ({ page }, info) => {
  await signIn(page);
  await edge("/__state", { down: ["rpc:137"] });
  await page.goto("/app/predictions");
  await expect(page.getByTestId("predictions-cash")).toHaveText("Unavailable", { timeout: 30_000 });
  await expect(page.getByTestId("predictions-cash-unavailable")).toHaveText("We couldn't read your cash from Polygon just now. Try again in a minute.");
  await page.goto("/app/predictions/5001");
  const form = await openTrade(page, info, "Yes");
  await enterAmount(form, info, "5");
  await form.getByRole("button", { name: "Buy Yes" }).click();
  await expect(flow(page)).toContainText("We couldn't reach Polygon, where your predictions account is, just now. Nothing was sent. Try again in a minute.", { timeout: 30_000 });
  await expect(flow(page)).not.toContainText("could not be read");
});

test("where Polymarket doesn't take orders, a buy is refused before anything is set up, and says what still works", async ({ page }, info) => {
  await signIn(page);
  await page.setExtraHTTPHeaders({ "CF-IPCountry": "US" });
  await page.goto("/app/predictions/5001");
  const form = await openTrade(page, info, "Yes");
  await enterAmount(form, info, "5");
  await form.getByRole("button", { name: "Buy Yes" }).click();
  await expect(flow(page)).toContainText("Predictions aren't available where you are. You can still sell what you hold and withdraw.", { timeout: 30_000 });
});

test("Polymarket not answering shows unavailable", async ({ page }) => {
  await signIn(page);
  await edge("/__state", { down: ["polymarket"] });
  await page.goto("/app/predictions");
  await expect(page.getByTestId("predictions-unavailable")).toBeVisible({ timeout: 30_000 });
  // Cash is read from Polygon, which still answers; positions come from Polymarket, so the total can't be shown.
  await expect(page.getByTestId("predictions-value")).toHaveText("Unavailable");
  await expect(page.getByText("We couldn't read your positions from Polymarket.")).toBeVisible();
});

test("guests see a labelled example Up or Down market with a moving price, and trading asks them to sign in", async ({ page }, info) => {
  await page.goto("/app/predictions/201");
  await expect(page.getByRole("note")).toContainText("Example data", { timeout: 30_000 });
  await expect(page.getByTestId("prediction-price-to-beat")).toHaveText("$64,210.50");
  await expect(page.getByTestId("prediction-live-chart")).toBeVisible();
  await expect(page.getByText("Example data, shaped like Polymarket's")).toBeVisible();
  if (!isPhone(info)) await expect(panel(page).getByRole("button", { name: "Sign in to trade" })).toBeVisible();
});

test("guests see labelled example predictions, and trading asks them to sign in", async ({ page }, info) => {
  await page.goto("/app/predictions");
  await expect(page.getByRole("heading", { name: "Predictions", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("note")).toContainText("Example data");
  await expect(page.getByRole("article", { name: /transit budget by March\? \(example\)/ })).toBeVisible();
  await shot(page, info, "guest-predictions");
});

test("with the switch off, Predictions says it isn't available yet", async ({ page }) => {
  await setFeature(page, "predictions", false);
  await signIn(page);
  await page.goto("/app/predictions");
  await expect(page.getByRole("heading", { name: "Predictions aren't available yet" })).toBeVisible({ timeout: 30_000 });
});

test("a position opens its market by slug, with its value, profit, and Sell", async ({ page }) => {
  await signIn(page);
  await edge("/__markets", { positions: [predictionPosition({ id: 5004, title: "Will ether close the year above $4,000?", size: 50, avgPrice: 0.3, currentPrice: 0.37 })] });
  await page.goto("/app/predictions");
  const positions = page.getByRole("list", { name: "Your prediction positions" });
  await expect(positions).toContainText("$18.50", { timeout: 30_000 });
  await expect(positions).toContainText("+$3.50");
  await positions.getByRole("link").click();
  await expect(page).toHaveURL(/\/app\/predictions\/market-5004$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Will ether close the year above $4,000?" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Your position" }).getByRole("button", { name: "Sell" })).toBeVisible();
});


test("on the phone, nothing on the Predictions pages sits under the menu button", async ({ page }, info) => {
  test.skip(!isPhone(info), "The menu button is the phone's.");
  await signIn(page);
  for (const path of ["/app/predictions", "/app/predictions/5001"]) {
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
