import type { Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { expect, test } from "../e2e/support/fixtures";

// The app screens on the landing page (apps/web/public/images/aura-*.webp): the guest app with its labelled example
// data, in both themes, on a computer and a phone. Re-run after a change the screens show, then check the images:
// `pnpm --filter @aurel/web exec playwright test -c playwright.inventory.config.ts landing-screens --project=desktop-chromium`.

// A computer at 1280 × 800 and a phone at 390 × 760, each drawn larger than it shows so the text stays sharp. The landing
// page shows the phone shots on a phone, where a computer's screen would be too small to read, and next to "Only you can
// move your money" at every width.
const COMPUTER = { width: 1280, height: 800, scale: 1.5 };
const PHONE = { width: 390, height: 760, scale: 2 };
const SHOTS = [
  { file: "overview", path: "/app", heading: "Overview", size: COMPUTER },
  { file: "overview-phone", path: "/app", heading: "Overview", size: PHONE },
  { file: "settings-phone", path: "/app/settings#security", heading: "Security", size: PHONE }
] as const;

/** A PNG screenshot as WebP, encoded by the browser itself so this needs no image library. */
async function toWebp(page: Page, png: Buffer) {
  const data = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")!.drawImage(image, 0, 0);
    return canvas.toDataURL("image/webp", 0.86).split(",")[1];
  }, png.toString("base64"));
  return Buffer.from(data, "base64");
}

test.beforeEach(({ browserName }, info) => test.skip(info.project.name !== "desktop-chromium" || browserName !== "chromium", "One run makes every size"));

for (const shot of SHOTS) for (const theme of ["light", "dark"] as const) {
  test(`landing screen ${shot.file} ${theme}`, async ({ browser }) => {
    const { width, height, scale } = shot.size;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: theme, isMobile: width < 768, hasTouch: width < 768,
      extraHTTPHeaders: { "CF-IPCountry": "CH" } });
    await context.addInitScript((value) => localStorage.setItem("aurel-theme", value), theme);
    const page = await context.newPage();
    await page.goto(shot.path);
    await expect(page.getByRole("heading", { name: shot.heading, exact: true }).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Example data", { exact: true }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    const png = await page.screenshot({ animations: "disabled", caret: "hide" });
    writeFileSync(`public/images/aura-${shot.file}${theme === "dark" ? "-dark" : ""}.webp`, await toWebp(page, png));
    await context.close();
  });
}
