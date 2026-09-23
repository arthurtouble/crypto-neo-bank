import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("landing leads to an email-only waitlist and one success burst", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/growth/waitlist", async (route) => {
    requests++;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body).toMatchObject({ email: "person@example.com", privacyNoticeVersion: "2026-09-23" });
    expect(body).not.toHaveProperty("countryCode");
    await route.fulfill({ status: 202, contentType: "application/json", body: '{"received":true}' });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Join waitlist" }).first().click();
  await expect(page).toHaveURL(/\/waitlist$/);
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Country" })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Email" }).fill("person@example.com");
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await expect(page.getByRole("status")).toContainText("We’ll email you");
  await expect(page.getByTestId("waitlist-confetti")).toHaveCount(1);
  await expect(page.getByTestId("waitlist-confetti")).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByTestId("waitlist-confetti")).toHaveCount(0, { timeout: 5000 });
  expect(requests).toBe(1);
});

test("a paused signup shows an error and never celebrates", async ({ page }) => {
  await page.route("**/api/growth/waitlist", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"received":false,"message":"The waitlist is paused right now."}' }));
  await page.goto("/waitlist");
  await page.getByRole("textbox", { name: "Email" }).fill("person@example.com");
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await expect(page.getByRole("alert")).toContainText("paused");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByTestId("waitlist-confetti")).toHaveCount(0);
});

test("reduced motion keeps the confirmation without particles", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/growth/waitlist", (route) => route.fulfill({ status: 202, contentType: "application/json", body: '{"received":true}' }));
  await page.goto("/waitlist");
  await page.getByRole("textbox", { name: "Email" }).fill("person@example.com");
  await page.getByRole("button", { name: "Join waitlist" }).click();
  await expect(page.getByRole("status")).toContainText("We’ll email you");
  await expect(page.getByTestId("waitlist-confetti")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
