import type { Page } from "@playwright/test";
import { AAVE_POOL, VAULTS } from "./support/fake-edge.mjs";
import { expect, test } from "./support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer } from "./support/session";

// Feature 5 in docs/overview/feature-readiness.md: Earn. Aave on Base and two
// Morpho USDC vaults. Privy's relay, the passkey, the chain (Aave's pool and
// the vaults, with their own events), and the Aave and Morpho rate services
// are the local fake; Aura's pages, API routes, controls, verifier, and D1 run
// for real.

const toast = (page: Page, title: string) => page.locator(".toastRegion").getByText(title, { exact: true });
const toasts = (page: Page) => page.locator(".toastRegion");
const card = (page: Page, title: string) => page.getByRole("article", { name: title });
const form = (page: Page, title: string) => card(page, title).getByRole("form");
const relayed = async () => ((await edge("/__sent")).sent ?? []).filter((item) => item.relayed);

async function held(page: Page, customer: Customer, id: string) {
  const overview = await asCustomer(page, customer, "GET", "/api/overview") as { holdings: Array<{ id: string; amountRaw: string | null }> };
  return overview.holdings.find((item) => item.id === id)?.amountRaw ?? "0";
}

/** A customer with a passkey and 50 USDC on Base, on the Earn page. */
async function openEarn(page: Page, balances: Record<string, string> = { [ASSETS.usdc]: "50000000" }) {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: balances });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  await page.goto("/app/earn");
  await expect(card(page, "Steakhouse Prime USDC")).toBeVisible({ timeout: 30_000 });
  return customer;
}

async function act(page: Page, title: string, direction: "Deposit" | "Withdraw", amount: string) {
  await form(page, title).getByLabel("Action").selectOption(direction.toLowerCase());
  await form(page, title).getByLabel("Amount").fill(amount);
  await form(page, title).getByRole("button", { name: direction, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "defi_actions", true);
});

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app/earn", "/api/defi/morpho/vaults", "/api/defi/aave/markets"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("Earn shows Aave and both Morpho vaults with their rates, liquidity, and deposits", async ({ page }) => {
  await openEarn(page);
  await expect(card(page, "Aave USDC")).toContainText("3.85%");
  await expect(card(page, "Aave WETH")).toContainText("1.95%");
  await expect(card(page, "Steakhouse Prime USDC")).toContainText("4.41%");
  await expect(card(page, "Steakhouse Prime USDC")).toContainText("curated by Steakhouse Financial");
  await expect(card(page, "Steakhouse Prime USDC")).toContainText("$163.0m");
  await expect(card(page, "Gauntlet USDC Prime")).toContainText("4.38%");
  await expect(card(page, "Gauntlet USDC Prime")).toContainText("$415.0m");
  await expect(page.getByText("Sky")).toHaveCount(0);
});

test("USDC goes into Aave and comes back out, checked against Aave's own events", async ({ page }) => {
  const customer = await openEarn(page);
  await act(page, "Aave USDC", "Deposit", "10");
  await expect(toast(page, "Deposit complete")).toBeVisible({ timeout: 30_000 });
  const [supply] = await relayed();
  expect(supply.calls!.map((call) => call.to.toLowerCase())).toEqual([ASSETS.usdc, AAVE_POOL]);
  expect(await held(page, customer, `aave:8453:${ASSETS.usdc}`)).toBe("10000000");
  await expect(page.getByTestId("position-aave-USDC")).toHaveText("Your position: 10 USDC", { timeout: 20_000 });

  await page.locator(".toastRegion").getByRole("button").first().click().catch(() => undefined);
  await act(page, "Aave USDC", "Withdraw", "4");
  await expect(toast(page, "Withdraw complete")).toBeVisible({ timeout: 30_000 });
  expect(await held(page, customer, `aave:8453:${ASSETS.usdc}`)).toBe("6000000");
  expect(await held(page, customer, `8453:${ASSETS.usdc}`)).toBe("44000000");
});

test("USDC goes into a Morpho vault, and Withdraw all redeems every share", async ({ page }) => {
  const customer = await openEarn(page);
  await act(page, "Steakhouse Prime USDC", "Deposit", "20");
  await expect(toast(page, "Deposit complete")).toBeVisible({ timeout: 30_000 });
  const [deposit] = await relayed();
  expect(deposit.calls!.map((call) => call.to.toLowerCase())).toEqual([ASSETS.usdc, VAULTS.steakhouse]);
  await expect(page.getByTestId("position-steakhouse-prime-usdc")).toContainText("Your position: 19.99", { timeout: 20_000 });

  await page.locator(".toastRegion").getByRole("button").first().click().catch(() => undefined);
  await form(page, "Steakhouse Prime USDC").getByLabel("Action").selectOption("withdraw");
  await form(page, "Steakhouse Prime USDC").getByRole("button", { name: "Withdraw all" }).click();
  await expect(toast(page, "Withdraw complete")).toBeVisible({ timeout: 30_000 });
  expect(await held(page, customer, `morpho:8453:${VAULTS.steakhouse}`)).toBe("0");
  expect(Number(await held(page, customer, `8453:${ASSETS.usdc}`))).toBeGreaterThanOrEqual(49_999_999);
});

test("an exact amount can be withdrawn from a Morpho vault", async ({ page }) => {
  // 100 Gauntlet shares, worth 105 USDC.
  const customer = await openEarn(page, { [VAULTS.gauntlet]: "100000000000000000000" });
  await expect(page.getByTestId("position-gauntlet-usdc-prime")).toHaveText("Your position: 105 USDC", { timeout: 20_000 });
  await act(page, "Gauntlet USDC Prime", "Withdraw", "30");
  await expect(toast(page, "Withdraw complete")).toBeVisible({ timeout: 30_000 });
  expect(await held(page, customer, `8453:${ASSETS.usdc}`)).toBe("30000000");
  expect(Number(await held(page, customer, `morpho:8453:${VAULTS.gauntlet}`))).toBeGreaterThanOrEqual(74_999_999);
});

test("rates that can't be read show as unavailable, never as a number", async ({ page }) => {
  await edge("/__state", { down: ["aave", "morpho"] });
  await openEarn(page);
  await expect(page.getByTestId("apy-steakhouse-prime-usdc")).toHaveText("Unavailable");
  await expect(page.getByTestId("apy-aave-USDC")).toHaveText("Unavailable", { timeout: 20_000 });
  // Aave's data service failing is said once, after its retries; Morpho's vault list still shows, without numbers.
  await expect(page.getByText("Aave rates are unavailable right now.")).toBeVisible({ timeout: 30_000 });
  await expect(card(page, "Gauntlet USDC Prime")).toContainText("Unavailable");
});

test("the server refuses: switched off, account locked, not enough USDC, or USDC paused", async ({ page }) => {
  const customer = await openEarn(page);
  await setFeature(page, "defi_actions", false);
  await act(page, "Steakhouse Prime USDC", "Deposit", "5");
  await expect(toasts(page)).toContainText("This feature is temporarily unavailable.", { timeout: 20_000 });

  await setFeature(page, "defi_actions", true);
  await asCustomer(page, customer, "PATCH", "/api/security/policy", { accountLocked: true });
  await form(page, "Steakhouse Prime USDC").getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(toasts(page)).toContainText("Your account is locked", { timeout: 20_000 });
  await asCustomer(page, customer, "PATCH", "/api/security/policy", { accountLocked: false });

  await act(page, "Steakhouse Prime USDC", "Deposit", "60");
  await expect(toasts(page)).toContainText("You don't have enough USDC.", { timeout: 20_000 });

  const { token } = await edge("/__session", { userId: "did:privy:e2e-operator" });
  const pause = (paused: boolean) => page.request.patch("/api/ops/assets", { headers: { Authorization: `Bearer ${token}`, Connection: "close" },
    data: { assetId: `8453:${ASSETS.usdc}`, ...(paused ? { paused, reason: "Test" } : { paused }) } });
  await pause(true);
  await act(page, "Aave USDC", "Deposit", "5");
  await expect(toasts(page)).toContainText("USDC is paused right now", { timeout: 20_000 });
  await pause(false);
  expect(await relayed()).toEqual([]);
});

test("a vault whose access rules changed is refused until it's reviewed again", async ({ page }) => {
  await edge("/__state", { vaultGate: "0x3333333333333333333333333333333333333333" });
  await openEarn(page);
  await act(page, "Steakhouse Prime USDC", "Deposit", "5");
  await expect(toasts(page)).toContainText("Steakhouse Prime USDC changed. It's paused in Aura until it's reviewed again.", { timeout: 20_000 });
  expect(await relayed()).toEqual([]);
});

test("a vault without enough liquidity rejects the withdrawal, and nothing moves", async ({ page }) => {
  await edge("/__state", { vaultIlliquid: true });
  const customer = await openEarn(page, { [VAULTS.gauntlet]: "100000000000000000000" });
  await act(page, "Gauntlet USDC Prime", "Withdraw", "30");
  await expect(toast(page, "Withdraw failed")).toBeVisible({ timeout: 30_000 });
  await expect(toasts(page)).toContainText("The network rejected it. Nothing moved.");
  expect(await held(page, customer, `8453:${ASSETS.usdc}`)).toBe("0");
});

test("cancelling the passkey prompt deposits nothing", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aura-e2e-passkey", "reject"));
  await openEarn(page);
  await act(page, "Aave USDC", "Deposit", "5");
  await expect(toast(page, "Cancelled")).toBeVisible({ timeout: 20_000 });
  expect(await relayed()).toEqual([]);
});
