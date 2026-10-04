import type { BrowserContext, Page, TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { BRIDGE, VAULTS } from "../e2e/support/fake-edge.mjs";
import { expect, test } from "../e2e/support/fixtures";
import { acceptTerms, asCustomer, ASSETS, edge, newCustomer, operatorHeaders, setBalances, setControls, setFeature, setIdentity, type Customer } from "../e2e/support/session";

// Phase 1 of docs/overview/redesign.md: a screenshot of every screen, dialog,
// and state, on desktop and mobile, against the e2e fake (no dev money). It
// checks nothing; run it with `pnpm --filter @aurel/web exec playwright test
// -c playwright.inventory.config.ts`. Screenshots go to output/inventory.

const OPS = `http://127.0.0.1:${process.env.AUREL_E2E_OPS_PORT ?? "43175"}`;
const FRIEND = "0x5555555555555555555555555555555555555555";
const SECTIONS = ["overview", "deposit", "send", "swap", "earn", "cards", "transactions", "settings", "support"] as const;
const path = (section: string) => section === "overview" ? "/app" : `/app/${section}`;
const FEATURES = ["direct_transfers", "swaps", "cross_chain", "defi_actions", "fiat_accounts", "payment_cards", "card_wallets", "card_deposits", "perps", "predictions"];

const funded = {
  8453: {
    [ASSETS.usdc]: "1825500000", native: "2000000000000000000", [ASSETS.cbbtc]: "1000000",
    [ASSETS.eurc]: "100000000", [ASSETS.apple]: "250000000", [ASSETS.aaveUsdc]: "50000000", [VAULTS.gauntlet]: "100000000000000000000"
  },
  1: { [ASSETS.xaut]: "500000" }
};

async function shot(page: Page, info: TestInfo, name: string, options: { full?: boolean; wait?: number } = {}) {
  await page.waitForTimeout(options.wait ?? 800);
  const dir = `../../output/inventory/${info.project.name}`;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage: options.full ?? true, animations: "disabled" });
}

/** Wait for the page's heading, then give data a moment to arrive. */
async function settle(page: Page, heading?: string | RegExp) {
  if (heading) await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 45_000 });
  await page.waitForLoadState("load");
  await page.waitForTimeout(2500);
}

/** Wait past the app's retries until the page says what it couldn't read. */
async function settleError(page: Page) {
  await settle(page);
  await page.getByText(/unavailable|couldn’t|can’t|can't|try again|may be missing/i).first().waitFor({ timeout: 25_000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
}

async function customerWith(page: Page, balances: object = {}, options: Parameters<typeof newCustomer>[0] = { mfa: ["passkey"] }) {
  const customer = await newCustomer(options);
  if (Object.keys(balances).length) await setBalances(customer.wallet, balances);
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  return customer;
}

async function allFeatures(page: Page, enabled: boolean) {
  for (const key of FEATURES) await setFeature(page, key, key === "card_wallets" ? false : enabled);
}

/** A step that adds a screenshot if it works, and is skipped if the page doesn't offer it. */
const optional = (step: () => Promise<void>) => step().catch((error: Error) => console.log(`skipped: ${error.message.split("\n")[0]}`));

const openNav = async (page: Page) => { if (page.viewportSize()!.width < 800) await page.getByRole("button", { name: "Open navigation" }).click(); };
const dark = (page: Page) => page.addInitScript(() => localStorage.setItem("aurel-theme", "dark"));

test.setTimeout(300_000);

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const section of SECTIONS) await request.get(path(section), { timeout: 120_000 });
  await request.get("/api/overview", { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("public pages", async ({ page }, info) => {
  await page.goto("/");
  await settle(page, "Money you control, in one simple app");
  await shot(page, info, "00-landing");
  if (page.viewportSize()!.width < 800) {
    await page.getByText("Menu", { exact: true }).click();
    await shot(page, info, "00-landing--menu-open", { full: false });
  }
  await page.goto("/pay/unknown_aura_tag");
  await settle(page, "Payment page unavailable");
  await shot(page, info, "02-pay-tag--unknown");

  const payee = await newCustomer();
  const tag = `sam${payee.wallet.slice(2, 8).toLowerCase()}`;
  await acceptTerms(page, payee);
  await asCustomer(page, payee, "PUT", "/api/aura-tags", { tag, address: payee.wallet, displayName: "Sam Rivera", publicEnabled: true });
  await page.goto(`/pay/${tag}`);
  await settle(page);
  await shot(page, info, "02-pay-tag--found");

  await page.goto("/design-system.html");
  await settle(page);
  await shot(page, info, "03-design-system-reference");
  await page.goto("/app/nope");
  await settle(page);
  await shot(page, info, "04-not-found");
});

test("landing and guest overview in dark", async ({ page }, info) => {
  await dark(page);
  await page.goto("/");
  await settle(page, "Money you control, in one simple app");
  await shot(page, info, "00-landing--dark");
  await page.goto("/app");
  await settle(page, "Overview");
  await shot(page, info, "10-overview--guest--dark");
});

test("signed out: every section shows labeled example data", async ({ page }, info) => {
  for (const section of SECTIONS) {
    await page.goto(path(section));
    await settle(page);
    await shot(page, info, `${10 + SECTIONS.indexOf(section)}-${section}--guest`);
  }
  await openNav(page);
  await shot(page, info, "05-shell--guest--nav", { full: false });
});

test("sign-in, terms, and session", async ({ page }, info) => {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setIdentity(page, customer);
  await page.goto("/app");
  await settle(page, "Overview");
  await page.getByRole("button", { name: "Create account or sign in" }).click();
  await settle(page, "Review Aura’s terms");
  await shot(page, info, "06-terms-gate");
  await page.getByRole("checkbox").check();
  await shot(page, info, "06-terms-gate--checked");

  const other = await newCustomer();
  await acceptTerms(page, other);
  const { token } = await edge("/__session", { userId: other.userId, expiresIn: -60 });
  const context = page.context();
  const expired = await context.newPage();
  await setIdentity(expired, { ...other, token: token! }, { signedIn: true });
  await expired.goto("/app");
  await expect(expired.getByText("Your session expired").first()).toBeVisible({ timeout: 30_000 });
  await shot(expired, info, "06-session-expired");
  await expired.close();
});

test("loading: every section while its data is on the way", async ({ page }, info) => {
  await allFeatures(page, true);
  await customerWith(page, funded);
  // Hold every API call except the terms check, so each page stays in its loading state.
  await page.route(/\/api\/(?!terms)/, () => undefined);
  for (const section of SECTIONS) {
    await page.goto(path(section));
    await page.waitForTimeout(3500);
    await shot(page, info, `${10 + SECTIONS.indexOf(section)}-${section}--loading`, { full: false, wait: 0 });
  }
});

test("empty: a new customer with nothing yet", async ({ page }, info) => {
  await edge("/__reset");
  await allFeatures(page, true);
  await customerWith(page);
  for (const section of SECTIONS) {
    await page.goto(path(section));
    await settle(page);
    await shot(page, info, `${10 + SECTIONS.indexOf(section)}-${section}--empty`);
  }
});

test("switched off: every feature switch off", async ({ page }, info) => {
  await edge("/__reset");
  await allFeatures(page, false);
  await customerWith(page, funded);
  for (const section of ["deposit", "send", "swap", "earn", "cards"] as const) {
    await page.goto(path(section));
    await settle(page);
    await shot(page, info, `${10 + SECTIONS.indexOf(section)}-${section}--switched-off`);
  }
  await allFeatures(page, true);
});

test("errors: the account, chains, prices, and providers can't be read", async ({ page }, info) => {
  await edge("/__reset");
  await allFeatures(page, true);
  await customerWith(page, funded);
  await edge("/__state", { down: ["privy"] });
  for (const section of SECTIONS) {
    await page.goto(path(section));
    await settleError(page);
    await shot(page, info, `${10 + SECTIONS.indexOf(section)}-${section}--error-account`);
  }
  await edge("/__state", { down: ["rpc:1", "kraken", "transfers", "aave", "morpho", "stripe", "lifi"] });
  for (const section of ["overview", "earn", "transactions", "swap"] as const) {
    await page.goto(path(section));
    await settleError(page);
    await shot(page, info, `${10 + SECTIONS.indexOf(section)}-${section}--error-partial`);
  }
  await edge("/__state", { down: [] });
});

/** A customer with money in every group, a card with payments, bank details, and some history. */
async function richCustomer(page: Page): Promise<Customer> {
  await edge("/__reset");
  await allFeatures(page, true);
  const customer = await customerWith(page, funded, { mfa: ["passkey"], connectedWallet: true });
  await setBalances(customer.externalWallets[0], { 8453: { [ASSETS.usdc]: "250000000" } });
  await asCustomer(page, customer, "POST", "/api/money/onboarding", { fullName: "Jane Customer", email: customer.email });
  await edge("/__bridge/kyc", { email: customer.email });
  await asCustomer(page, customer, "GET", "/api/money/account");
  await edge("/__bridge/cards", { email: customer.email });
  await asCustomer(page, customer, "POST", "/api/cards");
  await edge("/__state", { allowances: { [`8453:${ASSETS.usdc}:${customer.wallet.toLowerCase()}:${BRIDGE.cardsSpender}`]: "100000000" } });
  for (const [amount, merchant] of [["12", "Corner Cafe"], ["30", "Books"], ["8", "Corner Cafe"]]) {
    await edge("/__stripe/authorize", { amount, merchant });
    await edge("/__stripe/capture");
  }
  await edge("/__stripe/authorize", { amount: "400", merchant: "Electronics" });
  await edge("/__receive", { chainId: 8453, to: customer.wallet, token: ASSETS.usdc, amount: "20000000", from: FRIEND });
  await edge("/__bridge/deposit", { email: customer.email, amount: "250", senderName: "Jane Customer" });
  await setControls(page, customer, { newAddressDelayHours: 0 });
  await asCustomer(page, customer, "POST", "/api/security/addresses", { address: FRIEND, label: "Sam" });
  return customer;
}

test("funded: every section, dialog, and flow step", async ({ page }, info) => {
  test.setTimeout(600_000);
  const customer = await richCustomer(page);
  const dialog = page.getByRole("dialog");

  for (const section of SECTIONS) {
    await page.goto(path(section));
    await settle(page);
    await shot(page, info, `${10 + SECTIONS.indexOf(section)}-${section}--funded`);
  }

  // Shell: navigation, search, notifications.
  await page.goto("/app");
  await settle(page, "Overview");
  await openNav(page);
  await shot(page, info, "05-shell--nav", { full: false });
  await page.goto("/app");
  await settle(page, "Overview");
  await page.getByRole("button", { name: "Open search and commands" }).click();
  await shot(page, info, "05-shell--search", { full: false });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await shot(page, info, "05-shell--notifications", { full: false });
  await page.keyboard.press("Escape");

  // Send: the dialog, its errors, the review, and the result.
  await page.goto("/app/send");
  await settle(page, "Send crypto");
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  await expect(dialog).toBeVisible();
  await shot(page, info, "12-send--dialog", { full: false });
  await dialog.getByLabel("Amount").fill("5000");
  await dialog.getByLabel("To").fill("0x123");
  await dialog.getByRole("button", { name: "Review" }).click();
  await shot(page, info, "12-send--dialog-invalid", { full: false });
  await dialog.getByLabel("Amount").fill("12.5");
  await dialog.getByRole("group", { name: "Recipients" }).getByRole("button", { name: /^Sam/ }).click();
  await shot(page, info, "12-send--dialog-saved-recipient", { full: false });
  await dialog.getByRole("button", { name: "Review" }).click();
  await expect(page.getByTestId("send-review")).toBeVisible({ timeout: 20_000 });
  await shot(page, info, "12-send--review", { full: false });
  await dialog.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.locator(".toastRegion").getByText("Transfer complete", { exact: true })).toBeVisible({ timeout: 30_000 });
  await shot(page, info, "12-send--complete", { full: false });
  await optional(async () => {
    await page.reload();
    await settle(page, "Send crypto");
    await page.getByLabel("Aura tag").fill("@nobody-here");
    await page.getByRole("button", { name: "Find recipient" }).click();
    await shot(page, info, "12-send--tag-unknown", { wait: 2500 });
  });
  await optional(async () => {
    await page.getByRole("button", { name: "Add bank account" }).first().click();
    await shot(page, info, "12-send--bank-account-form");
  });

  // Swap: the pickers and a quote.
  await page.goto("/app/swap");
  await settle(page, "Swap");
  const pickers = page.locator(".swapPicker, [aria-haspopup=dialog]");
  if (await pickers.count()) {
    await pickers.last().click();
    await shot(page, info, "13-swap--asset-picker", { full: false });
    await page.keyboard.press("Escape");
  }
  await page.goto(`/app/swap?to=8453:${ASSETS.apple}`);
  await settle(page, "Swap");
  await page.getByLabel("Amount to swap").fill("20");
  await page.getByRole("button", { name: "Get quote" }).click();
  await page.waitForTimeout(4000);
  await shot(page, info, "13-swap--quote");

  // Earn: a deposit form.
  await page.goto("/app/earn");
  await settle(page, "Earn");
  await page.getByRole("button", { name: "Deposit", exact: true }).first().click().catch(() => undefined);
  await shot(page, info, "14-earn--deposit-form");

  // Cards: details and a dispute form.
  await page.goto("/app/cards");
  await settle(page, "Cards");
  const dispute = page.getByRole("button", { name: "Dispute" }).first();
  if (await dispute.count()) {
    await dispute.click();
    await shot(page, info, "15-cards--dispute-form");
  }

  // Transactions: a receipt, the statement dialog, and the detail page.
  const close = () => dialog.getByRole("button", { name: "Close" }).first().click().catch(() => page.keyboard.press("Escape"));
  await page.goto("/app/transactions");
  await settle(page, "Transactions");
  await optional(async () => {
    await page.locator(".activityRow").first().click();
    await expect(dialog).toBeVisible();
    await shot(page, info, "16-transactions--receipt", { full: false });
    await close();
  });
  await optional(async () => {
    await page.getByRole("button", { name: "Export" }).click();
    await shot(page, info, "16-transactions--export", { full: false });
    await close();
  });
  await optional(async () => {
    await page.reload();
    await settle(page, "Transactions");
    await page.locator(".activityRow").filter({ hasText: "12.5" }).first().click();
    await shot(page, info, "16-transactions--receipt-sent", { full: false });
  });

  // The summary's chart as a table.
  await optional(async () => {
    await page.goto("/app/transactions");
    await settle(page, "Transactions");
    const toggle = page.getByRole("button", { name: "Show chart and merchants" });
    if (await toggle.count()) await toggle.click();
    await page.getByText("Show as a table").first().click();
    await shot(page, info, "17-insights--table");
  });

  // Locked account.
  await setControls(page, customer, { accountLocked: true });
  for (const section of ["overview", "send", "settings"] as const) {
    await page.goto(path(section));
    await settle(page);
    await shot(page, info, `${10 + SECTIONS.indexOf(section)}-${section}--locked`);
  }
});

test("funded, in dark", async ({ page }, info) => {
  test.setTimeout(400_000);
  await dark(page);
  await richCustomer(page);
  for (const section of SECTIONS) {
    await page.goto(path(section));
    await settle(page);
    await shot(page, info, `${10 + SECTIONS.indexOf(section)}-${section}--funded--dark`);
  }
  await page.goto("/app/send");
  await settle(page, "Send crypto");
  await page.getByRole("button", { name: "Send", exact: true }).first().click();
  await shot(page, info, "12-send--dialog--dark", { full: false });
});

test("no passkey: settings and money actions ask for one", async ({ page }, info) => {
  await edge("/__reset");
  await allFeatures(page, true);
  await customerWith(page, funded, { mfa: [] });
  await page.goto("/app/settings");
  await settle(page, "Settings");
  await shot(page, info, "18-settings--no-passkey");
});

async function signedInToOps(context: BrowserContext, options: { none?: boolean } = {}) {
  await context.route(`${OPS}/api/**`, async (route) => route.continue({
    headers: { ...route.request().headers(), ...(options.none ? {} : await operatorHeaders()) } }));
}

test("operations console", async ({ page, context, browser }, info) => {
  await expect.poll(async () => (await fetch(OPS).catch(() => null))?.status ?? 0, { timeout: 60_000 }).toBe(200);
  const customer = await richCustomer(page);
  await signedInToOps(context);

  const outsider = await browser.newContext({ viewport: page.viewportSize()! });
  await signedInToOps(outsider, { none: true });
  const out = await outsider.newPage();
  await out.goto(`${OPS}/#customers`);
  await out.waitForTimeout(3000);
  await shot(out, info, "30-ops--signed-out");
  await outsider.close();

  for (const hash of ["customers", "movement", "stats", "controls"]) {
    await page.goto(`${OPS}/#${hash}`);
    await page.waitForTimeout(4000);
    await shot(page, info, `3${["customers", "movement", "stats", "controls"].indexOf(hash) + 1}-ops-${hash}`);
  }
  await page.goto(`${OPS}/#customers`);
  const customers = page.getByRole("region", { name: "Customers", exact: true });
  await customers.getByRole("textbox", { name: "Customer" }).fill(customer.userId);
  await customers.getByRole("button", { name: "Find" }).click();
  await expect(page.getByTestId("ops-customer")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await shot(page, info, "31-ops-customers--customer");
  await page.getByTestId("ops-customer").getByRole("button", { name: "Lock account" }).click().catch(() => undefined);
  await shot(page, info, "31-ops-customers--lock-form");
  await page.goto(`${OPS}/#movement`);
  await page.waitForTimeout(3000);
  const row = page.getByRole("button", { name: /Sent|Received|Card payment/ }).first();
  if (await row.count()) {
    await row.click();
    await shot(page, info, "32-ops-movement--journey", { full: false });
  }
});

// The docs site isn't part of the e2e server. Start it with `pnpm docs:dev --port 4321` to include it.
const DOCS = process.env.AURA_INVENTORY_DOCS_URL ?? "http://127.0.0.1:4321";

test("docs site", async ({ page }, info) => {
  test.skip(!(await fetch(DOCS).then((response) => response.ok, () => false)), `docs site not running at ${DOCS}`);
  for (const [name, url] of [["home", "/"], ["guide", "/product/send-and-route/"], ["legal", "/legal/terms-of-use/"], ["not-found", "/nope/"]]) {
    await page.goto(`${DOCS}${url}`);
    await page.waitForTimeout(1500);
    await shot(page, info, `40-docs-${name}`);
  }
  await openDocsNav(page);
  await shot(page, info, "40-docs-home--nav", { full: false });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(DOCS);
  await page.waitForTimeout(1000);
  await shot(page, info, "40-docs-home--dark");
});

async function openDocsNav(page: Page) {
  await page.goto(DOCS);
  await page.waitForTimeout(1000);
  const toggle = page.getByRole("button", { name: /menu|navigation/i }).first();
  if (await toggle.isVisible().catch(() => false)) await toggle.click();
}
