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

test("public landing page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("mobile layout does not overflow and retains product entry", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only assertion");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Get Started" }).last()).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("theme and private access gate remain usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle color theme" }).last().click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
  if (page.viewportSize()!.width < 800) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Earn" }).click();
  await expect(page.getByRole("heading", { name: "Earn" })).toBeVisible();
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in to continue/ })).toBeVisible();
});

test("every Aura section is browsable with labeled fictional data", async ({ page }) => {
  test.setTimeout(90_000);
  for (const section of ["deposit", "send", "swap", "earn", "invest", "cards", "rewards", "transactions", "insights", "settings", "support"]) {
    await page.goto(`/app/${section}`);
    await expect(page.getByRole("heading", { name: section[0].toUpperCase() + section.slice(1), exact: true })).toBeVisible();
    await expect(page.getByText("Example data", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in to continue" })).toBeVisible();
  }
});

test("unknown Aura tags do not expose recipient information", async ({ page }) => {
  await page.goto("/pay/unknown_aura_tag");
  await expect(page.getByRole("heading", { name: "Payment page unavailable" })).toBeVisible();
  await expect(page.getByText("Bank transfer", { exact: true })).toHaveCount(0);
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
  for (const path of ["/api/activity", "/api/insights", "/api/cards", "/api/aura-tags", "/api/actions/00000000-0000-4000-8000-000000000000", "/api/money/account", "/api/recipients", "/api/ops/summary", "/api/ops/features", "/api/ops/analytics", "/api/security/policy"]) {
    const response = await request.get(path);
    expect([401, 403], path).toContain(response.status());
    expect(response.headers()["cache-control"], path).toContain("no-store");
    expect(await response.json(), path).toHaveProperty("traceId");
  }
});

test("feedback and financial actions fail closed without authentication", async ({ request }) => {
  const quote = await request.get("/api/routes/quote?from=8453:native&to=8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913&amount=1");
  expect(quote.status()).toBe(401);
  const action = await request.post("/api/actions", { data: { kind: "earn", protocol: "aave", direction: "deposit", asset: "USDC", amount: "1" } });
  expect(action.status()).toBe(401);
  const feedback = await request.post("/api/feedback", { data: { surface: "/app", sentiment: "neutral", category: "usability", message: "This is a useful test message." } });
  expect(feedback.status()).toBe(401);
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
