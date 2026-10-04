import type { Page } from "@playwright/test";
import { BRIDGE } from "./support/fake-edge.mjs";
import { expect, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer } from "./support/session";

// Feature 11 in docs/overview/feature-readiness.md: Insights, since 4 October 2026
// the summary at the top of Transactions (Rewards was cut). The chain and
// Alchemy's transfer index over it, Privy, Bridge, and Stripe are the local
// fake; Aura's pages, API routes, and D1 run for real.

const FRIEND = "0x5555555555555555555555555555555555555555";
const chart = (page: Page) => page.getByRole("region", { name: "Money in and out" });
const merchants = (page: Page) => page.getByRole("region", { name: "Top card merchants" });

/** Transactions, with the summary's chart and merchants opened (closed until asked for, then remembered). */
async function openSummary(page: Page) {
  await page.goto("/app/transactions");
  const toggle = page.getByRole("button", { name: /chart and merchants$/ });
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
}

async function signIn(page: Page) {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "100000000" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  return customer;
}

/** A card with a 100 USDC allowance, as after the card tests, and two settled purchases. */
async function cardPayments(page: Page, customer: Customer) {
  await asCustomer(page, customer, "POST", "/api/money/onboarding", { fullName: "Jane Customer", email: customer.email });
  await edge("/__bridge/kyc", { email: customer.email });
  await asCustomer(page, customer, "GET", "/api/money/account");
  await edge("/__bridge/cards", { email: customer.email });
  await asCustomer(page, customer, "POST", "/api/cards");
  await edge("/__state", { allowances: { [`8453:${ASSETS.usdc}:${customer.wallet.toLowerCase()}:${BRIDGE.cardsSpender}`]: "100000000" } });
  for (const [amount, merchant] of [["12", "Corner Cafe"], ["30", "Books"], ["8", "Corner Cafe"]]) {
    expect(await edge("/__stripe/authorize", { amount, merchant })).toMatchObject({ approved: true });
    await edge("/__stripe/capture");
  }
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "fiat_accounts", true);
  await setFeature(page, "payment_cards", true);
});

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  for (const key of ["fiat_accounts", "payment_cards"]) await setFeature(page, key, false);
  await page.close();
});

test("the summary shows money in and out over time, and the card merchants paid most", async ({ page }) => {
  test.setTimeout(90_000);
  const customer = await signIn(page);
  await cardPayments(page, customer);
  await edge("/__receive", { chainId: 8453, to: customer.wallet, token: ASSETS.usdc, amount: "20000000", from: FRIEND });
  await page.goto("/app/transactions");
  // The chart and merchants open on request, and stay open after a reload.
  await expect(page.getByTestId("money-out")).toHaveText("$50", { timeout: 30_000 });
  await expect(chart(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Show chart and merchants" }).click();
  await page.reload();
  await expect(page.getByTestId("money-out")).toHaveText("$50", { timeout: 30_000 });
  await expect(page.getByTestId("money-in")).toHaveText("$20");

  // Both series have a legend; hovering the latest week reads out both.
  await expect(chart(page).locator(".chartLegend")).toContainText("Money in");
  await expect(chart(page).locator(".chartLegend")).toContainText("Money out");
  const hits = chart(page).locator(".chartHit");
  await hits.last().hover();
  const tooltip = chart(page).locator(".chartTooltip");
  await expect(tooltip).toContainText("Week of");
  await expect(tooltip).toContainText("$20.00");
  await expect(tooltip).toContainText("$50.00");
  // Tapping another week, as on a phone, reads that one out instead.
  await hits.first().click();
  await expect(tooltip).toContainText("$0.00");
  // The same numbers as a table.
  await chart(page).getByText("Show as a table").click();
  await expect(chart(page).getByRole("columnheader", { name: "Week of" })).toBeVisible();
  await expect(chart(page).getByRole("row").last()).toContainText("$50.00");

  await expect(merchants(page).getByTestId("top-merchant")).toHaveCount(2);
  await expect(merchants(page).getByTestId("top-merchant").first()).toContainText("Books");
  await expect(merchants(page).getByTestId("top-merchant").first()).toContainText("$30.00");
  await expect(merchants(page).getByTestId("top-merchant").nth(1)).toContainText("Corner Cafe");
  await expect(merchants(page).getByTestId("top-merchant").nth(1)).toContainText("2 payments");
  await expect(merchants(page).getByTestId("top-merchant").nth(1)).toContainText("$20.00");
  // Tapping a merchant shows its card payments in the list.
  await merchants(page).getByRole("button", { name: /Corner Cafe/ }).click();
  await expect(page.locator(".activityRow")).toHaveCount(2);
  await expect(page.getByPlaceholder("Search activity")).toHaveValue("Corner Cafe");

  // A year is shown by month.
  await page.getByRole("button", { name: "1 year" }).click();
  await chart(page).getByText("Show as a table").click({ timeout: 20_000 });
  await expect(chart(page).getByRole("columnheader", { name: "Month" })).toBeVisible();
  await expect(chart(page).locator(".chartHit")).toHaveCount(13);
});

test("when card payments can't be read from Stripe, money in and out show as unavailable, not zero", async ({ page }) => {
  const customer = await signIn(page);
  await cardPayments(page, customer);
  await edge("/__state", { down: ["stripe"] });
  await openSummary(page);
  await expect(page.getByTestId("money-out")).toHaveText("Unavailable", { timeout: 30_000 });
  await expect(page.getByTestId("money-in")).toHaveText("Unavailable");
  await expect(chart(page).getByText("Money in and out can't all be read right now.")).toBeVisible();
  await expect(merchants(page).getByText("Card payments can't all be read right now.")).toBeVisible();
});

test("with no transactions yet, Transactions says so once and points to Add money instead of showing $0 totals", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/transactions");
  await expect(page.getByText("No transactions yet")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "Add money" })).toHaveAttribute("href", "/app/deposit");
  await expect(page.getByRole("region", { name: "Summary" })).toHaveCount(0);
});

test("without a card, the summary still shows money in and out, and says there are no card payments", async ({ page }) => {
  const customer = await signIn(page);
  await edge("/__receive", { chainId: 8453, to: customer.wallet, token: ASSETS.usdc, amount: "20000000", from: FRIEND });
  await openSummary(page);
  await expect(page.getByTestId("money-in")).toHaveText("$20", { timeout: 30_000 });
  await expect(page.getByTestId("money-out")).toHaveText("$0");
  await expect(merchants(page).getByText("No card payments in this period.")).toBeVisible();
  // When received money can't be read, the chart shows only money out and says why.
  await edge("/__state", { down: ["transfers"] });
  await page.reload();
  await expect(page.getByTestId("money-in")).toHaveText("Unavailable", { timeout: 30_000 });
  await expect(chart(page).getByText("Money in can't all be read right now, so only money out is shown.")).toBeVisible();
  await expect(chart(page).locator(".chartLegend")).toHaveCount(0);
});
