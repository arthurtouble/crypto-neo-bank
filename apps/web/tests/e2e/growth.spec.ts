import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("landing leads to the private-access application and safe success", async ({ page }) => {
  await page.route("**/api/growth/events", async (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: true }) }));
  await page.route("**/api/growth/applications", async (route) => route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ received: true, applicationReference: "safe-reference", traceId: "trace" }) }));
  await page.goto("/");
  await page.getByRole("link", { name: "Apply for Private Access" }).click();
  await expect(page.getByRole("heading", { name: "Tell us what you need." })).toBeVisible();
  await page.getByLabel("Main goal").selectOption("move");
  await page.getByLabel("How often does this come up?").selectOption("weekly");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Self-custody wallet").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("What would a better experience look like?").fill("Move USD Coin without managing the underlying network.");
  await page.getByLabel("Email").fill("member@example.com");
  await page.getByLabel("Private-access contact").check();
  await page.getByRole("button", { name: "Submit Application" }).click();
  await expect(page.getByRole("heading", { name: "Thank you." })).toBeVisible();
  await expect(page.getByText("Applying does not guarantee access.")).toBeVisible();
});

test("application keeps optional marketing independent and is accessible", async ({ page }) => {
  await page.route("**/api/growth/events", async (route) => route.fulfill({ status: 202, body: "{}" }));
  await page.goto("/apply");
  await expect(page.getByText("No deposit", { exact: true })).toBeVisible();
  await page.getByLabel("Main goal").selectOption("see");
  await page.getByLabel("How often does this come up?").selectOption("monthly");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Product updates")).not.toBeChecked();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("product tour labels provider-gated capabilities", async ({ page }) => {
  await page.route("**/api/growth/events", async (route) => route.fulfill({ status: 202, body: "{}" }));
  await page.goto("/tour");
  await expect(page.getByRole("heading", { name: "Finance without the machinery." })).toBeVisible();
  await expect(page.getByText("bank rails require provider activation")).toBeVisible();
  await expect(page.getByText("lifestyle concierge requires provider activation")).toBeVisible();
});

test("growth pages do not overflow on mobile", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "Mobile-only assertion");
  await page.route("**/api/growth/events", async (route) => route.fulfill({ status: 202, body: "{}" }));
  for (const path of ["/apply", "/tour"]) {
    await page.goto(path);
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
});

test("public growth telemetry rejects server-owned facts", async ({ request }) => {
  const response = await request.post("/api/growth/events", { data: { events: [{ eventName: "invite_issued", anonymousSessionId: "f5ba9bbc-4318-4fcb-8649-c9b3be2c315e", surface: "/", properties: {} }] } });
  expect(response.status()).toBe(400);
});

test("growth operations and customer data endpoints fail closed", async ({ request }) => {
  for (const path of ["/api/ops/growth/applications", "/api/ops/growth/funnel", "/api/ops/growth/campaigns", "/api/ops/growth/experiments", "/api/ops/growth/data-requests", "/api/growth/referrals"]) {
    const response = await request.get(path);
    expect([401, 403]).toContain(response.status());
  }
});
