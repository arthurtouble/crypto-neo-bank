import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("landing introduces Aura and its provider boundaries", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Money you control, in one simple app" })).toBeVisible();
  await expect(page.getByText("Send, swap, and earn from one wallet", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get started" })).toHaveCount(4);
  await expect(page.locator('a[href="/apply"], a[href="/tour"]')).toHaveCount(0);
  for (const title of ["Every balance", "Send", "Swap", "Earn", "Aura tag", "Card"]) {
    await expect(page.locator("#features h3").filter({ hasText: new RegExp(`^${title}`) })).toHaveCount(1);
  }
  await expect(page.locator("#features h3").filter({ hasText: "Card" })).toContainText("Coming soon");
  await expect(page.getByRole("heading", { name: "Only you can move your money" })).toBeVisible();
  await expect(page.locator("#faq details")).toHaveCount(4);
  await page.locator("#faq summary").filter({ hasText: "Can I use bank transfers and cards?" }).click();
  await expect(page.getByText("Both need our banking and card partners", { exact: false })).toBeVisible();
  await expect(page.locator(".ldDisclosure")).toContainText("Screens show example data, not real accounts.");
  await expect(page.locator(".ldDisclosure")).toContainText("Bank transfers and cards need approved partners.");
  await expect(page.getByText(`© ${new Date().getFullYear()} Aura`)).toBeVisible();
});

test("mobile navigation keeps product, FAQ, and docs reachable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/");
  await page.getByText("Menu", { exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(navigation.getByRole("link", { name: "Features" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Questions" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Docs" })).toBeVisible();
});

test("landing is accessible and fits common widths", async ({ page }) => {
  await page.goto("/");
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const report = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    expect(report.document).toBeLessThanOrEqual(report.viewport + 1);
  }
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("retired endpoints are gone", async ({ request }) => {
  for (const path of ["/api/growth/waitlist", "/api/goals", "/api/portfolio", "/api/portfolio/history", "/api/beta/access",
    "/api/demo/session", "/api/markets/orders", "/api/support/assistant", "/api/defi/aave/preview", "/api/intents/evaluate", "/api/swap/review", "/api/invest/catalog",
    "/api/privacy/data-requests", "/api/ops/privacy/data-requests"]) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
});

test("privacy, terms, and account operations fail closed", async ({ request }) => {
  for (const path of ["/api/ops/accounts?q=someone", "/api/privacy/consent", "/api/privacy/export", "/api/terms", "/api/preferences"]) {
    const response = await request.get(path);
    expect([401, 403], path).toContain(response.status());
    expect(response.headers()["cache-control"], path).toContain("no-store");
  }
});

test("the pre-launch application and tour routes are gone", async ({ request }) => {
  for (const path of ["/apply", "/tour"]) expect((await request.get(path)).status()).toBe(404);
});

test("a sanctioned place gets the unavailable page for the app and the API, but can read the landing page", async ({ page, request }) => {
  const from = { "CF-IPCountry": "IR" };
  expect((await request.get("/api/overview", { headers: from })).status()).toBe(451);
  expect((await request.get("/", { headers: from })).status()).toBe(200);
  await page.setExtraHTTPHeaders(from);
  const response = await page.goto("/app/send");
  expect(response?.status()).toBe(451);
  await expect(page.getByRole("heading", { name: "Aura isn't available where you are" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("search engines may index the landing page, not the app or payment pages", async ({ page, request }) => {
  // The e2e server runs the production configuration; dev (--env dev) asks to be kept out entirely (tests/unit/seo.test.ts).
  const robots = await (await request.get("/robots.txt")).text();
  for (const rule of ["Allow: /", "Disallow: /app", "Disallow: /api/", "Disallow: /pay/"]) expect(robots).toContain(rule);
  await page.goto("/");
  await expect(page).toHaveTitle("Aura");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/images\/aura-overview\.png$/);
  await page.goto("/pay/nobody");
  await expect(page).toHaveTitle("Pay with Aura");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});
