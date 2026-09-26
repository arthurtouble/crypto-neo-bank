import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
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
    [ASSETS.aaveUsdc]: "50000000"            // 50 USDC in Aave
  },
  1: { [ASSETS.skySavings]: "100000000000000000000" } // 100 sUSDS shares = 105 USDS
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
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign in to continue" }).click();

  await expect(page.getByRole("heading", { name: "Review Aura’s terms." })).toBeVisible();
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
  await expect(row(page, `8453:${ASSETS.weth}`)).toContainText("$250.00");
  await expect(row(page, `8453:${ASSETS.cbbtc}`)).toContainText("0.01 cbBTC");
  await expect(row(page, `8453:${ASSETS.cbbtc}`)).toContainText("$600.00");
  await expect(row(page, `aave:8453:${ASSETS.usdc}`)).toContainText("Aave on Base");
  await expect(row(page, `aave:8453:${ASSETS.usdc}`)).toContainText("$50.00");
  await expect(row(page, "sky:1:susds")).toContainText("Sky on Ethereum");
  await expect(row(page, "sky:1:susds")).toContainText("105 USDS");
  await expect(row(page, "sky:1:susds")).toContainText("$105.00");
  await expect(page.getByText(/Read from the chains at/)).toBeVisible();
  await expect(page.getByText(/total leaves them out/)).toHaveCount(0);
});

test("a returning customer goes straight to the Overview", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "5000000" } });
  await openOverview(page, customer);
  await expect(page.getByTestId("portfolio-total")).toHaveText("$5.00", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Review Aura’s terms." })).toHaveCount(0);
});

test("an empty account says so and points to Deposit", async ({ page }) => {
  const customer = await newCustomer();
  await openOverview(page, customer);
  await expect(page.getByText("Your account is empty")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("portfolio-total")).toHaveText("$0.00");
  await page.getByRole("link", { name: "Deposit" }).last().click();
  await expect(page).toHaveURL(/\/app\/deposit$/);
});

test("a balance that can't be read shows as unavailable, never as a number", async ({ page }) => {
  const customer = await newCustomer();
  await setBalances(customer.wallet, funded);
  await edge("/__state", { down: ["rpc:1"] });
  await openOverview(page, customer);

  await expect(row(page, "sky:1:susds")).toContainText("Unavailable", { timeout: 30_000 });
  await expect(page.getByTestId("portfolio-total")).toHaveText("$6,025.50");
  await expect(page.getByTestId("total-earn")).toHaveText("$50.00 + unavailable");
  await expect(page.getByText(/total leaves them out/)).toBeVisible();
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
  await edge("/__state", { down: ["privy"] });
  await openOverview(page, customer);

  await expect(page.getByText("Your balances are unavailable right now.")).toBeVisible({ timeout: 30_000 });
  await edge("/__state", { down: [] });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByTestId("portfolio-total")).toHaveText("$5.00", { timeout: 30_000 });
});

test("an expired session asks the customer to sign in again", async ({ page }) => {
  const valid = await newCustomer();
  await acceptTerms(page, valid);
  const { token } = await edge("/__session", { userId: valid.userId, expiresIn: -60 });
  await setIdentity(page, { ...valid, token: token! }, { signedIn: true });
  await page.goto("/app");
  await expect(page.getByText("Your session expired.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign in again" })).toBeVisible();
});

test("signing out returns to the example Overview", async ({ page }) => {
  const customer = await newCustomer();
  await openOverview(page, customer);
  await expect(page.getByTestId("portfolio-total")).toBeVisible({ timeout: 30_000 });
  // The header keeps Log out in reach on every width.
  await page.getByRole("button", { name: "Log out of Aura" }).click();
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
  await expect(page.getByTestId("portfolio-total")).toHaveCount(0);
});
