import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("partner sandbox exercises success and failure workflows", async ({ page }) => {
  await page.goto("/app/sandbox");
  await expect(page.getByRole("heading", { name: "Provider integration lab" })).toBeVisible();
  await page.getByRole("button", { name: /Allocate \$2,500/ }).click();
  await expect(page.locator(".receiptPanel").getByText("Review and sign")).toBeVisible();
  await page.getByRole("button", { name: /Failed transfer/ }).click();
  await page.getByRole("button", { name: /Withdraw \$1,000/ }).click();
  await expect(page.locator(".receiptPanel").getByText("The destination could not be verified. No funds moved.")).toBeVisible();
});

test("public trust center has no serious accessibility violations", async ({ page }) => {
  await page.goto("/docs");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("mobile layout does not overflow and retains product entry", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only assertion");
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Explore the product/ })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("theme and private access gate remain usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Toggle color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: /wallet only you control/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue securely/ })).toBeVisible();
});

test("security headers are applied", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response.headers()["content-security-policy"]).not.toContain("'unsafe-eval'");
});
