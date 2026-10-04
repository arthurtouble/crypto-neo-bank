import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("dialogs stay fixed to a long mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app");
  // A long page, scrolled well down, then a real portalled dialog opened on top of it.
  await page.evaluate(() => { document.body.style.minHeight = "6000px"; window.scrollTo(0, 4000); });
  await expect(async () => {
    await page.keyboard.press("Control+KeyK");
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await page.waitForTimeout(400);
  const geometry = await page.evaluate(() => {
    const overlay = document.querySelector(".mxDialogOverlay")!.getBoundingClientRect();
    const dialog = document.querySelector("[role=dialog]")!.getBoundingClientRect();
    return { overlayTop: overlay.top, overlayHeight: overlay.height, dialogTop: dialog.top, dialogBottom: dialog.bottom };
  });
  expect(geometry.overlayTop).toBe(0);
  expect(geometry.overlayHeight).toBe(844);
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
  if (page.viewportSize()!.width < 768) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: /^(Primary|Sections)$/ }).getByRole("link", { name: "Earn" }).click();
  await expect(page.getByRole("heading", { name: "Earn" })).toBeVisible();
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Create account or sign in/ })).toBeVisible();
});

test("⌘K finds actions as well as pages, and opens where each happens (B4)", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 768, "The search box is in the desktop top bar");
  await page.goto("/app");
  await expect(page.getByText("Example data", { exact: true })).toBeVisible();
  const search = page.getByRole("dialog", { name: "Search Aura" });
  // The shortcut works once the page has hydrated.
  await expect(async () => { await page.keyboard.press("ControlOrMeta+k"); await expect(search).toBeVisible({ timeout: 1_000 }); }).toPass({ timeout: 20_000 });
  const results = search.getByRole("listbox", { name: "Actions and pages" });
  await expect(results.getByRole("group", { name: "Actions" }).getByRole("option")).toHaveText([/^Send money/, /^Send to a bank/, /^Add money/, /^Swap assets/, /^Lock my account/]);
  await expect(results.getByRole("group", { name: "Go to" }).getByRole("option", { name: /^Settings/ })).toBeVisible();
  // Words a customer might use find the action; Enter opens where it happens, and nothing changes from here.
  await search.getByRole("combobox").fill("stolen");
  await expect(results.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/settings#emergency-lock$/);
  await expect(search).toHaveCount(0);
  // The arrow keys choose among the results.
  await page.keyboard.press("ControlOrMeta+k");
  await search.getByRole("combobox").fill("send");
  await page.keyboard.press("ArrowDown");
  await expect(results.getByRole("option", { selected: true })).toHaveText(/^Send to a bank/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/send#bank$/);
});

test("every Aura section is browsable with labeled fictional data", async ({ page }) => {
  test.setTimeout(90_000);
  for (const section of ["deposit", "send", "swap", "earn", "cards", "transactions", "insights", "settings", "support"]) {
    await page.goto(`/app/${section}`);
    // /app/deposit is titled Add money.
    const title = section === "deposit" ? "Add money" : section[0].toUpperCase() + section.slice(1);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.getByText("Example data", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account or sign in" })).toBeVisible();
  }
});

test("on the phone, every section scrolls far enough that nothing tappable is left under the menu button", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "The floating menu button is phone only");
  test.setTimeout(90_000);
  for (const section of ["", "deposit", "send", "swap", "earn", "cards", "transactions", "insights", "settings", "support"]) {
    await page.goto(`/app/${section}`);
    await expect(page.getByText("Example data", { exact: true })).toBeVisible();
    // Scrolled to the end once the page has finished growing (example rows, prices).
    await expect.poll(() => page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const menu = document.querySelector(".appMenuButton")!.getBoundingClientRect();
      return [...document.querySelectorAll("main a[href], main button, main input, main select, main textarea")]
        .map((el) => ({ name: (el.textContent || el.getAttribute("aria-label") || el.tagName).trim(), box: el.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.bottom > menu.top && box.top < menu.bottom && box.right > menu.left && box.left < menu.right)
        .map(({ name }) => name);
    }), { message: `/app/${section}`, timeout: 10_000 }).toEqual([]);
  }
});

test("Invest was cut: old links open Swap, where stocks, gold, and crypto are bought", async ({ page }) => {
  // /app/markets now redirects to Perps or Predictions (perps.spec.ts).
  for (const path of ["/app/invest"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/app\/swap$/);
    await expect(page.getByRole("heading", { name: "Swap", exact: true })).toBeVisible();
  }
  await expect(page.getByRole("navigation").getByRole("link", { name: "Invest" })).toHaveCount(0);
});

test("Rewards was cut: old links open Cards", async ({ page }) => {
  for (const path of ["/app/rewards", "/app/benefits"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/app\/cards$/);
    await expect(page.getByRole("heading", { name: "Cards", exact: true })).toBeVisible();
  }
  await expect(page.getByRole("navigation").getByRole("link", { name: "Rewards" })).toHaveCount(0);
  expect((await page.request.get("/api/rewards")).status()).toBe(404);
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

test("private APIs fail closed without an authenticated subject", async ({ request }) => {
  for (const path of ["/api/activity", "/api/insights", "/api/cards", "/api/aura-tags", "/api/actions/00000000-0000-4000-8000-000000000000", "/api/money/account", "/api/recipients", "/api/ops/summary", "/api/ops/features", "/api/ops/stats", "/api/security/policy", "/api/support/messenger", "/api/support/fin/activity?user_id=did:privy:abcdefgh12345678"]) {
    const response = await request.get(path);
    expect([401, 403], path).toContain(response.status());
    expect(response.headers()["cache-control"], path).toContain("no-store");
    expect(await response.json(), path).toHaveProperty("traceId");
  }
});

test("financial actions fail closed without authentication", async ({ request }) => {
  const quote = await request.get("/api/routes/quote?from=8453:native&to=8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913&amount=1");
  expect(quote.status()).toBe(401);
  const action = await request.post("/api/actions", { data: { kind: "earn", protocol: "aave", direction: "deposit", asset: "USDC", amount: "1" } });
  expect(action.status()).toBe(401);
});

test("provider webhooks reject unsigned events and unknown providers", async ({ request }) => {
  for (const provider of ["bridge", "privy", "stripe"]) {
    const response = await request.post(`/api/webhooks/${provider}`, { data: { event_id: "e2e-unsigned", type: "customer.updated" } });
    expect([401, 503], provider).toContain(response.status());
  }
  expect((await request.post("/api/webhooks/provider", { data: {} })).status()).toBe(404);
});

test("legacy documentation route points to the dedicated docs site", async ({ request }) => {
  const response = await request.get("/docs", { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(response.status());
  expect(response.headers().location).toBe("https://aurel-docs.aurel-events.workers.dev");
});

test("design system is accessible and responsive", async ({ page }) => {
  await page.goto("/design-system.html");
  await expect(page.getByRole("heading", { name: /Aura design system/ })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
