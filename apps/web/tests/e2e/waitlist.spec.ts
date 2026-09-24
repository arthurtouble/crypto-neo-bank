import { expect, test } from "@playwright/test";

test("old waitlist opens the browsable product", async ({ page }) => {
  await page.goto("/waitlist");
  await expect(page).toHaveURL(/\/app\/?$/);
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveCount(0);
});

test("closed public intake does not collect an email", async ({ request }) => {
  const response = await request.post("/api/growth/waitlist", { data: { email: "person@example.com" } });
  expect(response.status()).toBe(410);
  expect(await response.json()).toMatchObject({ error: "waitlist_closed" });
});
