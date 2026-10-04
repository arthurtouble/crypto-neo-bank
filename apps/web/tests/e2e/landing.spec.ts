import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { acceptTerms, newCustomer, setIdentity } from "./support/session";

test("landing introduces Aura and its provider boundaries", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Money you control, in one simple app" })).toBeVisible();
  await expect(page.getByText("Send, swap, and earn from one wallet", { exact: false })).toBeVisible();
  // Header (or the phone's pinned button), hero, closing section, and footer.
  await expect(page.getByRole("link", { name: "Get started" })).toHaveCount(4);
  await expect(page.locator('a[href="/apply"], a[href="/tour"]')).toHaveCount(0);
  for (const title of ["Add money", "Send", "Swap", "Earn", "Aura tag", "Card"]) {
    await expect(page.locator("#features h3").filter({ hasText: new RegExp(`^${title}`) })).toHaveCount(1);
  }
  await expect(page.locator("#features h3").filter({ hasText: "Card" })).toContainText("Coming soon");
  await expect(page.getByRole("heading", { name: "Only you can move your money" })).toBeVisible();
  await expect(page.locator("#faq details")).toHaveCount(4);
  await page.locator("#faq summary").filter({ hasText: "Can I use bank transfers and cards?" }).click();
  await expect(page.getByText("Bank transfers work once our banking partner approves Aura.", { exact: false })).toBeVisible();
  await expect(page.locator(".ldDisclosure")).toContainText("Screens show example data, not real accounts.");
  await expect(page.locator(".ldDisclosure")).toContainText("Bank transfers and cards need approved partners.");
  await expect(page.getByText(`© ${new Date().getFullYear()} Aura`)).toBeVisible();
  // Contact opens Support in the app, where Chat is, not the security report or a page about it.
  await expect(page.locator(".ldFooter").getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/app/support");
  // The app's screens come in both themes; only the page's theme shows. A phone gets the phone's screens, which it can read.
  await expect(page.locator(".ldScreen img:visible")).toHaveCount(2);
  const phone = page.viewportSize()!.width < 768;
  await expect.poll(() => page.locator(".ldShowcase img:visible").evaluate((image: HTMLImageElement) => new URL(image.currentSrc).pathname))
    .toBe(phone ? "/images/aura-overview-phone.webp" : "/images/aura-overview.webp");
  await expect(page.locator("#security img:visible")).toHaveAttribute("src", "/images/aura-settings-phone.webp");
});

test("a returning customer signs in from the landing page's header", async ({ page }) => {
  const customer = await newCustomer();
  await acceptTerms(page, customer);
  await setIdentity(page, customer);
  await page.goto("/");
  const header = page.viewportSize()!.width >= 768 ? page.locator(".ldHeaderActions") : page.getByRole("navigation", { name: "Mobile navigation" });
  if (page.viewportSize()!.width < 768) await page.getByText("Menu", { exact: true }).click();
  await header.getByRole("link", { name: "Sign in" }).click();
  // Sign-in opens straight away, without a stop at the example data.
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Example data", { exact: true })).toHaveCount(0, { timeout: 30_000 });
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
  // The app stays crawlable so search engines can read its noindex (lib/site/seo.ts).
  for (const rule of ["Allow: /", "Disallow: /api/", "Disallow: /pay/"]) expect(robots).toContain(rule);
  expect(robots).not.toContain("Disallow: /app");
  await page.goto("/");
  await expect(page).toHaveTitle(/^Aura: stablecoins, crypto, stocks, and gold/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /^index/);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/images\/aura-og\.png$/);
  const structured = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "");
  expect(structured["@graph"].map((node: { "@type": string }) => node["@type"])).toContain("FAQPage");
  expect(await (await request.get("/manifest.webmanifest")).json()).toMatchObject({ name: "Aura", start_url: "/app" });
  expect(await (await request.get("/llms.txt")).text()).toMatch(/^# Aura\n/);
  expect(await (await request.get("/app")).text()).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  await page.goto("/pay/nobody");
  await expect(page).toHaveTitle("Pay with Aura");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("Resend's delivery reports reach their own signed route, which refuses unsigned posts", async ({ request }) => {
  const response = await request.post("/api/webhooks/resend", { data: { type: "email.bounced", data: {} } });
  expect([401, 503]).toContain(response.status());
  expect((await response.json()).error).not.toBe("unknown_provider");
});
