import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("landing introduces Aura and its provider boundaries", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your Smart Account" })).toBeVisible();
  await expect(page.getByText("Spend anywhere, invest in global markets, and get incredible rewards. All from one app.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Get Started" })).toHaveCount(4);
  await expect(page.locator('a[href="/apply"], a[href="/tour"]')).toHaveCount(0);
  for (const title of ["A home for all your assets", "Spend", "Earn", "Send", "Invest", "Borrow", "Rewards", "Security"]) {
    await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
  }
  await expect(page.locator("#faq details")).toHaveCount(5);
  await page.locator("#faq summary").filter({ hasText: "Are bank transfers, cards, and rewards available?" }).click();
  await expect(page.getByText("These depend on provider connection", { exact: false })).toBeVisible();
  await expect(page.locator("#footnotes li")).toHaveCount(4);
  await expect(page.getByText(`© ${new Date().getFullYear()} Aura`)).toBeVisible();
});

test("mobile navigation keeps product, FAQ, and docs reachable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto("/");
  await page.getByText("Menu", { exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(navigation.getByRole("link", { name: "Features" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "FAQs" })).toBeVisible();
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

test("public growth telemetry rejects server-owned facts", async ({ request }) => {
  const response = await request.post("/api/growth/events", { data: { events: [{ eventName: "invite_issued", anonymousSessionId: "f5ba9bbc-4318-4fcb-8649-c9b3be2c315e", surface: "/", properties: {} }] } });
  expect(response.status()).toBe(400);
});

test("growth operations and customer data endpoints fail closed", async ({ request }) => {
  for (const path of ["/api/ops/growth/waitlist", "/api/ops/growth/campaigns", "/api/ops/growth/experiments", "/api/ops/growth/data-requests", "/api/growth/referrals"]) {
    const response = await request.get(path);
    expect([401, 403]).toContain(response.status());
  }
});

test("the pre-launch application and tour routes are gone", async ({ request }) => {
  for (const path of ["/apply", "/tour"]) expect((await request.get(path)).status()).toBe(404);
});
