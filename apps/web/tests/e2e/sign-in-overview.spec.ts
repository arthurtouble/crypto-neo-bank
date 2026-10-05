import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { VAULTS } from "./support/fake-edge.mjs";
import { acceptTerms, ASSETS, edge, newCustomer, setBalances, setIdentity, type Customer } from "./support/session";

// Feature 1 in docs/overview/feature-readiness.md: sign-in, terms, and the
// Overview. Privy, the chains, and prices are the local fake; Aura's server,
// its token checks, and D1 run for real.

const funded = {
  8453: {
    [ASSETS.usdc]: "125500000",              // 125.50 USDC
    native: "2000000000000000000",           // 2 ETH at $2,500
    [ASSETS.weth]: "100000000000000000",     // 0.1 WETH
    [ASSETS.cbbtc]: "1000000",               // 0.01 cbBTC at $60,000
    [ASSETS.aaveUsdc]: "50000000",           // 50 USDC in Aave
    [VAULTS.gauntlet]: "100000000000000000000" // 100 Morpho vault shares = 105 USDC
  }
};

async function openOverview(page: Page, customer: Customer) {
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  await page.goto("/app");
}

const row = (page: Page, id: string) => page.getByTestId(`holding-${id}`);

test.beforeEach(async () => { await edge("/__reset"); });

test.beforeAll(async ({ request }) => {
  // Compile the Overview route once, so the first test isn't racing a cold dev server.
  await edge("/__reset");
  const customer = await newCustomer();
  await request.get("/api/overview", { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("a new customer signs in, accepts the terms, and sees their balances", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, funded);
  await setIdentity(page, customer);

  await page.goto("/app");
  // The first guest load of /app in this file can sit on "Loading" while the dev server compiles it.
  await expect(page.getByText("Example data", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Create account or sign in" }).click();

  await expect(page.getByRole("heading", { name: "Review Aura’s terms" })).toBeVisible();
  const accept = page.getByRole("button", { name: "Continue" });
  await expect(accept).toBeDisabled();
  await page.getByRole("checkbox").check();
  await accept.click();

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByTestId("portfolio-total")).toHaveText("$6,130.50", { timeout: 30_000 });
  await expect(page.getByText("Example data", { exact: true })).toHaveCount(0);
});

test("the Overview values every holding in dollars and totals cash, crypto, and earn", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, funded);
  await openOverview(page, customer);

  await expect(page.getByTestId("portfolio-total")).toHaveText("$6,130.50", { timeout: 30_000 });
  await expect(page.getByTestId("total-cash")).toHaveText("$125.50");
  await expect(page.getByTestId("total-crypto")).toHaveText("$5,850.00");
  await expect(page.getByTestId("total-earn")).toHaveText("$155.00");

  await expect(row(page, `8453:${ASSETS.usdc}`)).toContainText("125.5 USDC");
  await expect(row(page, "8453:native")).toContainText("2 ETH");
  await expect(row(page, "8453:native")).toContainText("$5,000.00");
  // Crypto prices are live, so only paused feeds (stocks, gold, the euro) say when their price was published.
  await expect(row(page, "8453:native")).not.toContainText("Price as of");
  await expect(row(page, `8453:${ASSETS.weth}`)).toContainText("$250.00");
  await expect(row(page, `8453:${ASSETS.cbbtc}`)).toContainText("0.01 cbBTC");
  await expect(row(page, `8453:${ASSETS.cbbtc}`)).toContainText("$600.00");
  await expect(row(page, `aave:8453:${ASSETS.usdc}`)).toContainText("$50.00");
  await expect(row(page, `morpho:8453:${VAULTS.gauntlet}`)).toContainText("105 USDC");
  await expect(row(page, `morpho:8453:${VAULTS.gauntlet}`)).toContainText("$105.00");
  await expect(page.getByText(/^Updated \d/)).toBeVisible();
  await expect(page.getByText(/total leaves them out/)).toHaveCount(0);

  // Where each holding is kept shows in its detail.
  await row(page, `morpho:8453:${VAULTS.gauntlet}`).click();
  await expect(page.getByRole("dialog").getByRole("definition").nth(2)).toHaveText("Morpho");
  await page.keyboard.press("Escape");
  await row(page, `aave:8453:${ASSETS.usdc}`).click();
  await expect(page.getByRole("dialog").getByRole("definition").nth(2)).toHaveText("Aave");
});

test("stocks, the euro, and Tether Gold on Ethereum are valued from their feeds, with the price time shown", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, {
    8453: { [ASSETS.usdc]: "10000000", [ASSETS.eurc]: "100000000", [ASSETS.apple]: "250000000" }, // 10 USDC, 100 EURC, 2.5 Apple
    1: { [ASSETS.xaut]: "500000" }                                                                  // 0.5 XAUt, on Ethereum
  });
  await openOverview(page, customer);

  await expect(page.getByTestId("total-cash")).toHaveText("$124.00", { timeout: 30_000 });
  await expect(page.getByTestId("total-stocks")).toHaveText("$853.77");
  await expect(page.getByTestId("total-metals")).toHaveText("$2,142.81");
  await expect(page.getByTestId("portfolio-total")).toHaveText("$3,120.58");
  await expect(page.getByRole("region", { name: "Stocks" })).toContainText("Apple");
  await expect(row(page, `8453:${ASSETS.apple}`)).toContainText("2.5 AAPLc");
  await expect(row(page, `8453:${ASSETS.apple}`)).toContainText("Price as of");
  await expect(row(page, `1:${ASSETS.xaut}`)).toContainText("0.5 XAUt");
  await row(page, `1:${ASSETS.xaut}`).click();
  await expect(page.getByRole("dialog")).toContainText("Ethereum");
  await page.keyboard.press("Escape");
  await expect(row(page, `8453:${ASSETS.eurc}`)).toContainText("100 EURC");
  await expect(row(page, `8453:${ASSETS.eurc}`)).toContainText("$114.00");
});

test("a feed older than four days leaves the value unavailable, never the old price", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "10000000", [ASSETS.apple]: "250000000" } });
  await edge("/__state", { feedAgeSeconds: 5 * 24 * 3600 });
  await openOverview(page, customer);

  await expect(row(page, `8453:${ASSETS.apple}`)).toContainText("2.5 AAPLc", { timeout: 30_000 });
  await expect(row(page, `8453:${ASSETS.apple}`)).toContainText("Unavailable");
  await expect(row(page, `8453:${ASSETS.apple}`)).not.toContainText("Price as of");
  await expect(page.getByTestId("portfolio-total")).toHaveText("$10.00");
  await expect(page.getByText(/total leaves them out/)).toBeVisible();
});

test("a returning customer goes straight to the Overview", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "5000000" } });
  await openOverview(page, customer);
  await expect(page.getByTestId("portfolio-total")).toHaveText("$5.00", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Review Aura’s terms" })).toHaveCount(0);
});

test("an empty account says so and points to Add money", async ({ page }) => {
  const customer = await newCustomer();
  await openOverview(page, customer);
  await expect(page.getByText("Your account is empty")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("portfolio-total")).toHaveText("$0.00");
  // Recent transactions show on the phone as well as on desktop.
  await expect(page.getByRole("region", { name: "Recent transactions" })).toContainText("No transactions yet");
  // Each way to add money opens that way on Deposit.
  const empty = page.getByRole("region", { name: "Your account is empty" });
  // A way that can't be used yet says so before it's tapped (bank transfers are switched off here).
  await expect(empty.getByRole("link", { name: /^Bank/ })).toContainText("Coming soon");
  await empty.getByRole("link", { name: /^Card Buy/ }).click();
  await expect(page).toHaveURL(/\/app\/deposit#card$/);
  await expect(page.getByRole("tab", { name: "Card", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.goto("/app");
  await page.getByRole("link", { name: "Add money", exact: true }).last().click();
  await expect(page).toHaveURL(/\/app\/deposit$/);
});

test("each holding offers what can be done with it, set up for that asset", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "10000000", [ASSETS.apple]: "250000000", [ASSETS.aaveUsdc]: "50000000" } });
  await openOverview(page, customer);
  const panel = page.getByRole("dialog");
  const buttons = () => panel.locator(".ovPanelActions a");

  // A stock is bought with, or sold for, USDC, and Swap opens set up for it.
  await row(page, `8453:${ASSETS.apple}`).click({ timeout: 30_000 });
  await expect(buttons()).toHaveText(["Buy", "Sell", "Send"]);
  await panel.getByRole("link", { name: "Sell", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/swap\\?from=8453%3A${ASSETS.apple}&to=8453%3A${ASSETS.usdc}$`));

  await page.goto("/app");
  await row(page, `8453:${ASSETS.usdc}`).click({ timeout: 30_000 });
  await expect(buttons()).toHaveText(["Send", "Add money", "Swap"]);
  await page.keyboard.press("Escape");

  // An Earn position opens on Earn, to withdraw or deposit.
  await row(page, `aave:8453:${ASSETS.usdc}`).click();
  await expect(buttons()).toHaveText(["Withdraw", "Deposit"]);
  await panel.getByRole("link", { name: "Withdraw", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/earn\?position=aave%3A8453%3A0x[0-9a-f]{40}&action=withdraw$/);
});

test("a balance that can't be read shows as unavailable, never as a number", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, funded);
  await edge("/__state", { down: ["rpc:1"] });
  await openOverview(page, customer);

  // Tether Gold is held on Ethereum, so it's the one that can't be read.
  await expect(row(page, `1:${ASSETS.xaut}`)).toContainText("Unavailable", { timeout: 30_000 });
  await expect(page.getByTestId("portfolio-total")).toHaveText("$6,130.50");
  await expect(page.getByTestId("total-metals")).toHaveText("Unavailable");
  await expect(page.getByTestId("total-earn")).toHaveText("$155.00");
  await expect(page.getByText(/total leaves them out/)).toBeVisible();
});

test("when no balance can be read, the Overview says so instead of showing $0.00", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, funded);
  await edge("/__state", { down: ["rpc:1", "rpc:8453"] });
  await openOverview(page, customer);

  await expect(page.getByText("Your balances are unavailable right now.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("portfolio-total")).toHaveCount(0);
  await edge("/__state", { down: [] });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("portfolio-total")).toHaveText("$6,130.50", { timeout: 30_000 });
});

test("without a price, amounts still show and values say unavailable", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, funded);
  await edge("/__state", { down: ["kraken"] });
  await openOverview(page, customer);

  await expect(row(page, "8453:native")).toContainText("2 ETH", { timeout: 30_000 });
  await expect(row(page, "8453:native")).toContainText("Unavailable");
  await expect(page.getByTestId("total-cash")).toHaveText("$125.50");
  await expect(page.getByTestId("portfolio-total")).toHaveText("$280.50");
  await expect(page.getByText(/total leaves them out/)).toBeVisible();
});

test("when the account can't be looked up, the Overview offers to try again", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "5000000" } });
  // Accepting the terms reads the account's email from Privy, so Privy goes down after that.
  await acceptTerms(page, customer);
  await edge("/__state", { down: ["privy"] });
  await setIdentity(page, customer, { signedIn: true });
  await page.goto("/app");

  await expect(page.getByText("Your balances are unavailable right now.")).toBeVisible({ timeout: 30_000 });
  await edge("/__state", { down: [] });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("portfolio-total")).toHaveText("$5.00", { timeout: 30_000 });
});

test("a customer who signs in with a wallet adds an email before the terms", async ({ page }) => {
  const customer = await newCustomer({ email: false });
  await setIdentity(page, customer);
  await page.goto("/app");
  await page.getByRole("button", { name: "Create account or sign in" }).click();
  await expect(page.getByRole("heading", { name: "Add your email" })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("aura-e2e-link-email", "wallet-owner@example.com"));
  await page.getByRole("button", { name: "Add email" }).click();
  await expect(page.getByRole("heading", { name: "Review Aura’s terms" })).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Your account is empty")).toBeVisible({ timeout: 30_000 });
});

test("when sign-in can't load, Try again loads it afresh and opens it", async ({ page }) => {
  const customer = await newCustomer();
  await setIdentity(page, customer);
  await page.goto("/app");
  await expect(page.getByText("Example data", { exact: true })).toBeVisible({ timeout: 30_000 });
  // The connection drops while sign-in downloads; the browser then remembers that failure for this page load.
  await page.route(/web3-runtime-provider/, (route) => route.abort(), { times: 1 });
  await page.getByRole("button", { name: "Create account or sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Sign-in couldn't load. Check your connection, then try again.");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Review Aura’s terms" })).toBeVisible({ timeout: 30_000 });
});

test("terms updated while the customer reads them: Reload brings the new version", async ({ page }) => {
  const customer = await newCustomer();
  await setIdentity(page, customer, { signedIn: true });
  // The server's answer when the version accepted isn't the current one (a new version since the page loaded).
  let updated = false;
  await page.route("**/api/terms", (route) => {
    if (route.request().method() !== "POST" || updated) return route.fallback();
    updated = true;
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "terms_changed" }) });
  });
  await page.goto("/app");
  await page.getByRole("checkbox").check({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toHaveText("The terms were just updated. Reload to read the new version.");
  await page.getByRole("button", { name: "Reload" }).click();
  // A fresh page load, which the dev server can take a while to hydrate.
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled({ timeout: 30_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the server refuses the account until the current terms are accepted, and refuses them without an email", async ({ page }) => {
  const customer = await newCustomer();
  const headers = { Authorization: `Bearer ${customer.token}` };
  const overview = await page.request.get("/api/overview", { headers });
  expect(overview.status()).toBe(403);
  expect(await overview.json()).toMatchObject({ error: "terms_required" });
  await acceptTerms(page, customer);
  expect((await page.request.get("/api/overview", { headers })).status()).toBe(200);

  const noEmail = await newCustomer({ email: false });
  await expect(acceptTerms(page, noEmail)).rejects.toThrow("accepting terms failed: 403");
});

test("a customer who doesn't accept the terms can log out to the example data", async ({ page }) => {
  const customer = await newCustomer();
  await setIdentity(page, customer);
  await page.goto("/app");
  await page.getByRole("button", { name: "Create account or sign in" }).click();
  await expect(page.getByRole("heading", { name: "Review Aura’s terms" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Review Aura’s terms" })).toHaveCount(0);
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
});

test("an expired session asks the customer to sign in again", async ({ page }) => {
  const valid = await newCustomer();
  await acceptTerms(page, valid);
  const { token } = await edge("/__session", { userId: valid.userId, expiresIn: -60 });
  await setIdentity(page, { ...valid, token: token! }, { signedIn: true });
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Your session expired" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign in again" })).toBeVisible();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
});

test("signing out returns to the example Overview", async ({ page }) => {
  const customer = await newCustomer();
  await openOverview(page, customer);
  await expect(page.getByTestId("portfolio-total")).toBeVisible({ timeout: 30_000 });
  // Log out is in the account menu on desktop and in the menu sheet on the phone.
  await page.getByRole("button", { name: page.viewportSize()!.width < 768 ? "Open menu" : "Account" }).click();
  await page.getByRole("button", { name: "Log out of Aura" }).click();
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
  await expect(page.getByTestId("portfolio-total")).toHaveCount(0);
});
