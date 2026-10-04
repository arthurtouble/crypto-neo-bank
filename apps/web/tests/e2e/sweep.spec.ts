import AxeBuilder from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/fixtures";
import { acceptTerms, ASSETS, newCustomer, setBalances, setIdentity } from "./support/session";
import { navigation } from "../../src/lib/product-map";

/**
 * The quality-bar sweep (docs/product/design-system.md#quality-bar): every
 * page, as a guest and signed in, in light and dark, at every width from 320px
 * to 1440px. It checks what a person would notice on a small phone or at 200%
 * zoom: sideways scrolling, clipped text, small touch targets, content hidden
 * under the floating menu button, axe issues, console errors, and failed
 * requests.
 *
 * It runs only when asked, because it reports on the whole app rather than one
 * feature: `AURA_SWEEP=report` writes findings to output/sweep and passes;
 * `AURA_SWEEP=strict` fails on any finding. `AURA_SWEEP_ONLY=/app/send,/app/swap`
 * limits it to those pages. `pnpm sweep:report` turns the
 * findings into output/sweep/report.md.
 */
const mode = process.env.AURA_SWEEP;
const only = process.env.AURA_SWEEP_ONLY?.split(",").map((path) => path.trim());
const outDir = resolve(import.meta.dirname, "../../../../output/sweep");

// 640px is 1280px at 200% zoom: the browser lays the page out at half the width.
const widths = [320, 375, 390, 430, 640, 768, 1024, 1280, 1440];
const phoneBelow = 768;
const themes = ["light", "dark"] as const;
const identities = ["guest", "signed-in"] as const;
const pages = ["/", ...navigation.flatMap((group) => group.items.map((item) => item.href))].filter((href) => !only || only.includes(href));

type Finding = { width?: number; check: string; detail: string };

test.skip(!mode, "Runs with AURA_SWEEP=report or AURA_SWEEP=strict");
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== "desktop-chromium", "Sets its own widths, so one project is enough"); });

for (const path of pages) for (const identity of identities) for (const theme of themes) {
  test(`${path} ${identity} ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const findings: Finding[] = [];
    // React's development build asks for eval(), which the deployed Content Security Policy refuses; production doesn't.
    page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("eval() is not supported")) findings.push({ check: "console error", detail: message.text().slice(0, 300) }); });
    page.on("pageerror", (error) => findings.push({ check: "page error", detail: error.message.slice(0, 300) }));
    // A request the page itself cancels (a newer query, a beacon on resize) is aborted, not failed.
    page.on("requestfailed", (request) => request.failure()?.errorText !== "net::ERR_ABORTED" && findings.push({ check: "failed request", detail: `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}` }));
    page.on("response", (response) => { if (response.status() >= 500) findings.push({ check: "failed request", detail: `${response.status()} ${response.request().method()} ${response.url()}` }); });

    await page.addInitScript((value) => localStorage.setItem("aurel-theme", value), theme);
    if (identity === "signed-in") {
      const customer = await newCustomer();
      await setBalances(customer.wallet, { 8453: { [ASSETS.usdc]: "1234567890", native: "2000000000000000000", [ASSETS.cbbtc]: "1000000" } });
      await acceptTerms(page, customer);
      await setIdentity(page, customer, { signedIn: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(path, { timeout: 120_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 60_000 });
    if (identity === "signed-in") await expect(page.getByText("Example data", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await settle(page);

    for (const width of widths) {
      await page.setViewportSize({ width, height: width < phoneBelow ? 844 : 900 });
      await settle(page);
      for (const finding of await layoutFindings(page, width < phoneBelow)) findings.push({ width, ...finding });
      if (width === 390 || width === 1280) {
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        for (const violation of axe.violations) findings.push({ width, check: `axe ${violation.impact ?? ""}`.trim(),
          detail: `${violation.id}: ${violation.help} (${violation.nodes.slice(0, 3).map((node) => node.target.join(" ")).join(", ")})` });
      }
    }

    const unique = dedupe(findings);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, `${path.replaceAll("/", "_").replace(/^_/, "")}--${identity}--${theme}.json`),
      JSON.stringify({ path, identity, theme, findings: unique }, null, 2));
    if (mode === "strict") expect(unique, `${path} ${identity} ${theme}`).toEqual([]);
  });
}

/** Wait for the layout to stop moving after a load or a resize. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** Layout checks at the current width, in the page. */
function layoutFindings(page: Page, phone: boolean) {
  return page.evaluate((phone) => {
    const out: Array<{ check: string; detail: string }> = [];
    const root = document.documentElement;
    const label = (element: Element) => {
      const name = element.getAttribute("aria-label") ?? element.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) ?? "";
      const classes = typeof element.className === "string" && element.className ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
      return `${element.tagName.toLowerCase()}${classes}${name ? ` "${name}"` : ""}`;
    };
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      // Visually hidden labels (1px, clipped) are for screen readers, not a layout problem.
      return box.width > 1 && box.height > 1 && style.clip !== "rect(0px, 0px, 0px, 0px)" && style.visibility !== "hidden" && style.display !== "none" && !element.closest("[aria-hidden=true], [inert]");
    };

    // Sideways scrolling, and the widest things that cause it.
    if (root.scrollWidth > root.clientWidth + 1) {
      const wide = [...document.body.querySelectorAll("*")].filter((element) => visible(element) && element.getBoundingClientRect().right > root.clientWidth + 1)
        .filter((element) => ![...element.children].some((child) => child.getBoundingClientRect().right > root.clientWidth + 1));
      out.push({ check: "sideways scroll", detail: `page is ${root.scrollWidth}px wide; ${wide.slice(0, 4).map(label).join(", ")}` });
    }

    // Text cut off by a box that hides overflow without an ellipsis on purpose.
    for (const element of document.body.querySelectorAll("*")) {
      if (!visible(element) || ![...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) continue;
      const style = getComputedStyle(element);
      const hides = ["hidden", "clip"].includes(style.overflowX) || ["hidden", "clip"].includes(style.overflowY);
      if (!hides || style.textOverflow === "ellipsis") continue;
      if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) out.push({ check: "clipped text", detail: label(element) });
    }

    if (!phone) return out;

    // Touch targets under 44 × 44px. Links inside a sentence are exempt (WCAG 2.5.8).
    const targets = document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=switch], [role=checkbox], [role=radio], [role=option]");
    for (const element of targets) {
      if (!visible(element)) continue;
      if (element.matches("a") && element.closest("p, li > span, small") && !element.matches("[class*=Button], [class*=button]")) continue;
      if (element.matches("input[type=checkbox], input[type=radio]") && element.closest("label")) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 43.5 || box.height < 43.5) out.push({ check: "small touch target", detail: `${label(element)} is ${Math.round(box.width)} × ${Math.round(box.height)}` });
    }

    // Content under the floating menu button once scrolled to the end.
    const menu = document.querySelector(".appMenuButton");
    if (menu && visible(menu)) {
      window.scrollTo({ top: root.scrollHeight, behavior: "instant" });
      const top = menu.getBoundingClientRect().top;
      const main = document.querySelector("main") ?? document.body;
      const last = [...main.querySelectorAll("*")].filter((element) => visible(element) && element.children.length === 0)
        .reduce<Element | null>((lowest, element) => !lowest || element.getBoundingClientRect().bottom > lowest.getBoundingClientRect().bottom ? element : lowest, null);
      if (last && last.getBoundingClientRect().bottom > top) out.push({ check: "under the menu button", detail: `${label(last)} ends ${Math.round(last.getBoundingClientRect().bottom - top)}px below the button's top` });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    return out;
  }, phone);
}

/** One finding per check and detail, listing every width it happened at. */
function dedupe(findings: Finding[]) {
  const byKey = new Map<string, { check: string; detail: string; widths: number[] }>();
  for (const finding of findings) {
    const key = `${finding.check}|${finding.detail}`;
    const entry = byKey.get(key) ?? { check: finding.check, detail: finding.detail, widths: [] };
    if (finding.width && !entry.widths.includes(finding.width)) entry.widths.push(finding.width);
    byKey.set(key, entry);
  }
  return [...byKey.values()];
}
