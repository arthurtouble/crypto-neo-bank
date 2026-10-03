import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { expect, outcome, test } from "./support/fixtures";
import { acceptTerms, ASSETS, edge, newCustomer, setBalances, setFeature, setIdentity, type Customer } from "./support/session";

// Feature 7 in docs/overview/feature-readiness.md: Transactions. The chain
// (and Alchemy's transfer index over it), Privy, and the passkey are the local
// fake; Aura's pages, API routes, verifier, and D1 run for real.

const FRIEND = "0x5555555555555555555555555555555555555555";
const SPAM = "0x9999999999999999999999999999999999999999";
const dialog = (page: Page) => page.getByRole("dialog");
const rows = (page: Page) => page.locator(".activityRow");
const month = () => new Date().toISOString().slice(0, 7);
/** The type chips above the list. */
const category = (page: Page, name: string) => page.getByRole("group", { name: "Category" }).getByRole("button", { name, exact: true }).click();
/** The receipt closes with Close on desktop and Back on the phone, where it's a pushed screen. */
const closeReceipt = (page: Page) => dialog(page).getByRole("button", { name: /^(Close|Back)$/ }).click();

/** A signed-in customer with a passkey and 50 USDC on Base. */
async function signIn(page: Page) {
  const customer = await newCustomer({ mfa: ["passkey"] });
  await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "50000000" } });
  await acceptTerms(page, customer);
  await setIdentity(page, customer, { signedIn: true });
  return customer;
}

/** Send 10 USDC to a friend through Send, as a customer would. */
async function send(page: Page) {
  await page.goto("/app/send");
  const form = page.getByRole("region", { name: "Send crypto" });
  await form.getByLabel("Amount").fill("10");
  await form.getByLabel("To").fill(FRIEND);
  await form.getByRole("button", { name: "Review" }).click();
  // A first-time address is checked before the review (B2).
  await form.getByRole("button", { name: "It's correct" }).click();
  await form.getByRole("button", { name: "Confirm and send" }).click();
  await expect(outcome(page, "Transfer complete")).toBeVisible({ timeout: 30_000 });
}

const receive = (customer: Customer, amount: string, token: string = ASSETS.usdc, chainId = 8453) => edge("/__receive", { chainId, to: customer.wallet, token, amount, from: FRIEND });

async function download(page: Page, click: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent("download"), click()]);
  return readFile((await file.path())!, "utf8");
}

test.beforeEach(async ({ page }) => {
  await edge("/__reset");
  await setFeature(page, "direct_transfers", true);
});

test.beforeAll(async ({ request }) => {
  await edge("/__reset");
  const customer = await newCustomer();
  for (const path of ["/app/transactions", "/app/insights", "/app/send", "/api/activity"]) await request.get(path, { headers: { Authorization: `Bearer ${customer.token}` }, timeout: 120_000 });
});

test("money sent and money received both show, with who, where, and a link to the network", async ({ page }) => {
  const customer = await signIn(page);
  await send(page);
  await receive(customer, "20000000");
  // Unregistered tokens sent to the account are never listed.
  await receive(customer, "1000", SPAM);
  await page.goto("/app/transactions");

  await expect(rows(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(rows(page).nth(0)).toContainText("Received");
  await expect(rows(page).nth(0)).toContainText("20 USDC");
  await expect(rows(page).nth(0)).toContainText("Completed");
  await expect(rows(page).nth(1)).toContainText("Sent");
  await expect(rows(page).nth(1)).toContainText("10 USDC");

  await rows(page).nth(0).click();
  await expect(dialog(page)).toContainText(`From${FRIEND}`);
  await expect(dialog(page)).toContainText("Alchemy, Base");
  await expect(dialog(page).getByTestId("incoming-finality")).toHaveText("Final on Base.");
  await expect(dialog(page).getByRole("link", { name: /View on the network/ })).toHaveAttribute("href", /^https:\/\/basescan\.org\/tx\/0x[0-9a-f]{64}$/);
  await closeReceipt(page);

  await category(page, "Received");
  await expect(rows(page)).toHaveCount(1);
  await category(page, "Sent");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Sent");
  await category(page, "All");
  await page.getByPlaceholder("Search activity").fill("nothing like this");
  await expect(page.getByText("No matching activity")).toBeVisible();

  // The sent transaction's receipt carries its whole history, described the same way.
  await page.getByPlaceholder("Search activity").fill("");
  await expect(page.getByRole("region", { name: "Today" })).toBeVisible();
  await rows(page).nth(1).click();
  await expect(dialog(page).getByRole("heading", { name: "Sent" })).toBeVisible();
  await expect(dialog(page)).toContainText("10 USDC");
  await expect(dialog(page).getByText("Completed").first()).toBeVisible();
  await expect(dialog(page)).toContainText(FRIEND);
  await expect(dialog(page).getByRole("list", { name: "Progress" })).toContainText("Final on Base", { timeout: 20_000 });
  const reference = (await dialog(page).locator(".txReceiptRef .mxBreak").textContent())!;
  await closeReceipt(page);

  // An old link to the Full history page opens the receipt instead.
  await page.goto(`/app/transactions/${reference}`);
  await expect(page).toHaveURL(/\/app\/transactions\?open=/);
  await expect(dialog(page).getByRole("heading", { name: "Sent" })).toBeVisible({ timeout: 30_000 });
});

test("a failed action says why in plain words, and a card allowance moves no money", async ({ page }) => {
  await signIn(page);
  const sources = Object.fromEntries(["aura", "incoming", "aave", "card"].map((name) => [name, { status: "available", partial: false }]));
  const at = new Date().toISOString();
  // Only the list is stubbed here: an action that failed on the chain and a card allowance can't be made in one account by the fakes.
  await page.route("**/api/activity", (route) => route.fulfill({ json: { observedAt: at, sources, entries: [
    { id: "failed-swap", origin: "aura", type: "swap", status: "failed", createdAt: at, chainId: 8453, asset: "USDC", amount: "100", toAsset: "cbBTC", toAmount: "0.00104",
      failureReason: "operation_reverted", source: "Aura" },
    { id: "allowance", origin: "aura", type: "card_allowance", status: "completed", createdAt: at, chainId: 8453, asset: "USDC", amount: "500", counterparty: "Aura card", source: "Aura" }
  ] } }));
  await page.route("**/api/actions/*", (route) => route.fulfill({ status: 404, json: { error: "not_found" } }));
  await page.goto("/app/transactions");
  await expect(rows(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(rows(page).nth(1).locator(".txAmount strong")).toHaveCount(0);

  await rows(page).nth(0).click();
  await expect(dialog(page)).toContainText("100 USDC for 0.00104 cbBTC");
  await expect(dialog(page)).toContainText("The network rejected it. Nothing moved.");
  await expect(dialog(page)).not.toContainText("operation_reverted");
  await expect(dialog(page)).toContainText("Nothing was sent.");
});

test("a deposit is completed once in a block, and final when Base finalizes it", async ({ page }) => {
  await edge("/__state", { finalizeAll: false });
  const customer = await signIn(page);
  await receive(customer, "5000000");
  await page.goto("/app/transactions");
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(rows(page)).toContainText("Completed");
  await rows(page).click();
  await expect(dialog(page).getByTestId("incoming-finality")).toHaveText("Received. Base makes it final in about 20 minutes.");
  await closeReceipt(page);

  await edge("/__state", { finalizeAll: true });
  await page.reload();
  await rows(page).first().click();
  await expect(dialog(page).getByTestId("incoming-finality")).toHaveText("Final on Base.", { timeout: 30_000 });
});

test("Tether Gold received on Ethereum is listed too", async ({ page }) => {
  const customer = await signIn(page);
  await receive(customer, "250000", ASSETS.xaut, 1);
  await page.goto("/app/transactions");
  await expect(rows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(rows(page)).toContainText("0.25 XAUt");
  await expect(rows(page)).toContainText("Ethereum");
});

test("an empty account says so", async ({ page }) => {
  await signIn(page);
  await page.goto("/app/transactions");
  await expect(page.getByText("No activity yet")).toBeVisible({ timeout: 30_000 });
});

test("when received money can't be read, the list says deposits may be missing and still shows what it has", async ({ page }) => {
  const customer = await signIn(page);
  await send(page);
  await receive(customer, "20000000");
  await edge("/__state", { down: ["transfers"] });
  await page.goto("/app/transactions");
  await expect(page.getByText("Money you received can't be read right now")).toBeVisible({ timeout: 30_000 });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText("Sent");
});

test("the list exports as CSV, and a month downloads as a statement, or is refused when it can't be complete", async ({ page }) => {
  const customer = await signIn(page);
  await send(page);
  await receive(customer, "20000000");
  await page.goto("/app/transactions");
  await expect(rows(page)).toHaveCount(2, { timeout: 30_000 });

  await page.getByRole("button", { name: "Export" }).click();
  const list = await download(page, () => dialog(page).getByRole("button", { name: /This list/ }).click());
  expect(list.split("\n")[0]).toContain('"Date","Description","Status","Amount","Asset"');
  expect(list).toContain('"Received","Completed","20","USDC"');
  expect(list).toContain('"Sent","Completed","10","USDC"');

  await expect(dialog(page).getByLabel("Monthly statement")).toHaveValue(month());
  const statement = await download(page, () => dialog(page).getByRole("button", { name: "Download" }).click());
  expect(statement.trim().split("\n")).toHaveLength(3);
  expect(statement).toContain('"Received"');

  await edge("/__state", { down: ["transfers"] });
  await dialog(page).getByRole("button", { name: "Download" }).click();
  await expect(dialog(page).getByRole("alert")).toContainText("activity can't be read right now");
});

test("Insights counts money in and money out, and says when money in can't be known", async ({ page }) => {
  // Signing in, sending, and receiving take most of the default 30 s before Insights is even opened.
  test.setTimeout(90_000);
  const customer = await signIn(page);
  await send(page);
  await receive(customer, "20000000");
  await page.goto("/app/insights");
  await expect(page.getByTestId("money-in")).toHaveText("$20", { timeout: 30_000 });
  await expect(page.getByTestId("money-out")).toHaveText("$10");

  await edge("/__state", { down: ["transfers"] });
  await page.reload();
  await expect(page.getByTestId("money-in")).toHaveText("Unavailable", { timeout: 30_000 });
  await expect(page.getByTestId("money-out")).toHaveText("$10");
});
