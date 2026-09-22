import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("financial modals stay fixed to a long mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const productStyles = readFileSync("src/app/globals.css", "utf8");
  await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${productStyles}</style><main class="productContent"><div style="height: 6000px"><div class="modalBackdrop"><section class="financialModal" role="dialog"><h2>Review</h2></section></div></div></main>`);
  await page.waitForTimeout(500);
  const geometry = await page.locator(".modalBackdrop").evaluate((backdrop) => {
    const dialog = backdrop.querySelector("[role=dialog]")!;
    const backdropRect = backdrop.getBoundingClientRect();
    const dialogRect = dialog.getBoundingClientRect();
    return { backdropTop: backdropRect.top, backdropHeight: backdropRect.height, dialogTop: dialogRect.top, dialogBottom: dialogRect.bottom };
  });
  expect(geometry.backdropTop).toBe(0);
  expect(geometry.backdropHeight).toBe(844);
  expect(geometry.dialogTop).toBeGreaterThanOrEqual(0);
  expect(geometry.dialogBottom).toBeLessThanOrEqual(844);
});

test("portfolio history gap layout stays readable in desktop and mobile themes with reduced motion", async ({ page }) => {
  const styles = `${readFileSync("src/app/globals.css", "utf8")}\n${readFileSync("src/app/product-system.css", "utf8")}`;
  for (const width of [1280, 390]) for (const theme of ["light", "dark"] as const) {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style><div class="productShell" data-theme="${theme}"><main class="productContent"><section class="panel portfolioPerformance" aria-label="Verified portfolio history"><div class="portfolioChartHeader"><div><span>Historical portfolio value</span><strong class="sensitiveAmount">Unavailable</strong><small>Current day is incomplete</small><small>Return unavailable</small></div><div class="chartRanges" role="group" aria-label="Portfolio history range"><button aria-pressed="false">7D</button><button class="active" aria-pressed="true">1M</button><button aria-pressed="false">3M</button><button aria-pressed="false">1Y</button></div></div><div class="portfolioChart"><svg viewBox="0 0 720 200" aria-label="2 complete days and 1 coverage gap"><path class="chartLine" d="M0,80 L100,70"></path><line class="chartGapMarker" x1="360" x2="360" y1="4" y2="194"></line><path class="chartLine" d="M600,50 L720,40"></path></svg></div><div class="chartFoot"><span>Sep 17</span><small>Last complete Sep 21</small><span>Sep 21</span></div><div class="portfolioCoverage"><p>2 complete days; 1 gap.</p><ul><li><strong>Sep 19</strong>: ETH price missing</li></ul></div><div class="portfolioAave"><span>Aave supply <strong class="sensitiveAmount">unavailable</strong></span><span>Aave debt <strong class="sensitiveAmount">unavailable</strong></span></div></section></main></div>`);
    await page.locator("html").evaluate((element, selectedTheme) => element.setAttribute("data-theme", selectedTheme), theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByText("ETH price missing")).toBeVisible();
    await expect(page.locator(".chartGapMarker")).toHaveCount(1);
    await page.getByRole("button", { name: "1M" }).focus();
    await expect(page.getByRole("button", { name: "1M" })).toBeFocused();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

test("partner sandbox exercises success and failure workflows", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/app/sandbox");
  await expect(page.getByRole("heading", { name: "Provider integration lab" })).toBeVisible();
  const allocate = page.getByRole("button", { name: /Allocate \$2,500/ });
  await expect(allocate).toBeEnabled({ timeout: 45_000 });
  await allocate.click();
  await expect(page.locator(".receiptPanel").getByText("Review and sign")).toBeVisible();
  await page.getByRole("button", { name: /Failed transfer/ }).click();
  await page.getByRole("button", { name: /Withdraw \$1,000/ }).click();
  await expect(page.locator(".receiptPanel").getByText("The destination could not be verified. No funds moved.")).toBeVisible();
});

test("public landing page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("mobile layout does not overflow and retains product entry", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only assertion");
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Apply/ }).first()).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("theme and private access gate remain usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle color theme" }).last().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /wallet you control/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue securely/ })).toBeVisible();
});

test("security headers are applied", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
});

test("public health exposes dependencies without secrets", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.status).toBe("ok");
  expect(payload.dependencies).toMatchObject({ operationalDatabase: "ok" });
  expect(JSON.stringify(payload)).not.toMatch(/secret|token|password/i);
});

test("public status exposes bounded component state and no secrets", async ({ request }) => {
  const response = await request.get("/api/status");
  expect([200, 503]).toContain(response.status());
  const payload = await response.json();
  expect(payload).toHaveProperty("components");
  expect(payload).toHaveProperty("incidents");
  expect(JSON.stringify(payload)).not.toMatch(/app.secret|private.key|bearer/i);
});

test("private APIs fail closed without an authenticated subject", async ({ request }) => {
  for (const path of ["/api/portfolio", "/api/portfolio/history?range=7D", "/api/activity", "/api/insights", "/api/goals", "/api/bills", "/api/cards", "/api/income-plan", "/api/intents/status?intentId=00000000-0000-4000-8000-000000000000", "/api/money/account", "/api/recipients", "/api/transfer-schedules", "/api/ops/summary", "/api/ops/beta", "/api/ops/features", "/api/ops/analytics", "/api/security/policy", "/api/beta/access"]) {
    const response = await request.get(path);
    const accepted = path === "/api/portfolio" ? [401, 403, 410] : [401, 403];
    expect(accepted).toContain(response.status());
  }
});

test("feedback and beta redemption fail closed without authentication", async ({ request }) => {
  const quote = await request.post("/api/swap/quote", { data: { fromAssetId: "USDC", toAssetId: "ETH", amount: "1", fromAddress: "0x000000000000000000000000000000000000dEaD" } });
  expect(quote.status()).toBe(401);
  const rewards = await request.post("/api/defi/aave/rewards", { data: { sender: "0x000000000000000000000000000000000000dEaD" } });
  expect(rewards.status()).toBe(401);
  const feedback = await request.post("/api/beta/feedback", { data: { surface: "/app", sentiment: "neutral", category: "usability", message: "This is a useful test message." } });
  expect(feedback.status()).toBe(401);
  const redeem = await request.post("/api/beta/access", { data: { code: "AUREL-TEST", countryCode: "PT", acceptTerms: true } });
  expect(redeem.status()).toBe(401);
});

test("unsigned provider events are rejected", async ({ request }) => {
  const response = await request.post("/api/webhooks/provider", { data: { id: "e2e-unsigned", type: "account.updated" } });
  expect([400, 401, 403]).toContain(response.status());
});

test("legacy documentation route points to the dedicated docs site", async ({ request }) => {
  const response = await request.get("/docs", { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(response.status());
  expect(response.headers().location).toBe("https://aurel-docs.aurel-events.workers.dev");
});

test("design system is accessible and responsive", async ({ page }) => {
  await page.goto("/design-system.html");
  await expect(page.getByRole("heading", { name: /Quietly certain/ })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
