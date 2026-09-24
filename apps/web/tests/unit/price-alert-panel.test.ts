import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { commitAndRefresh, PriceAlertRow, TriggeredPriceAlertRow } from "@/components/price-alert-panel";

const alert = { alertId: "a", pairId: "ETH/USD" as const, baseAssetId: "8453:native", quoteAssetId: "iso4217:USD", quoteCurrency: "USD" as const,
  mappingVersion: "kraken-posttrade-eth-usd-v1", direction: "above" as const, threshold: "2500", hysteresisBps: 100,
  cooldownSeconds: 3600, status: "active" as const, thresholdVersion: 1, createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z" };

describe("price alert row", () => {
  it("shows a triggered source observation without presenting it as a trade or current quote", () => {
    const html = renderToStaticMarkup(createElement(TriggeredPriceAlertRow, { occurrence: {
      occurrenceId: "o1", alertId: "a", pairId: "ETH/USD", direction: "above", threshold: "3500",
      observedPrice: "3501.25", sourceObservedAt: "2026-09-23T10:00:00.123456Z"
    } }));
    expect(html).toContain("ETH reached $3,501.25");
    expect(html).toContain('dateTime="2026-09-23T10:00:00.123456Z"');
    expect(html).not.toContain("Review Swap");
    expect(html).not.toContain("Current price");
  });

  it("offers dismissal without a transaction action", () => {
    const html = renderToStaticMarkup(createElement(TriggeredPriceAlertRow, { occurrence: {
      occurrenceId: "o1", alertId: "a", pairId: "ETH/USD", direction: "above", threshold: "3500",
      observedPrice: "3501.25", sourceObservedAt: "2026-09-23T10:00:00Z"
    }, busy: false, onDismiss() {} }));
    expect(html).toContain(">Dismiss</button>");
    expect(html).not.toContain("Confirm Swap");
  });

  it("renders a saved, non-monitoring rule without inventing a current price or trade", () => {
    const html = renderToStaticMarkup(createElement(PriceAlertRow, { alert, busy: false, onEdit() {}, onChange() {} }));
    expect(html).toContain("ETH above $2,500");
    expect(html).toContain("Saved · Not monitoring");
    expect(html).toContain("Pause");
    expect(html).not.toContain("Review Swap");
    expect(html).not.toContain("Current price");
  });

  it("offers resume, not edit, for a paused rule", () => {
    const html = renderToStaticMarkup(createElement(PriceAlertRow, { alert: { ...alert, status: "paused" }, busy: false, onEdit() {}, onChange() {} }));
    expect(html).toContain("Resume");
    expect(html).not.toContain(">Edit<");
  });

  it("keeps saved rules visible but prevents activation when planning is unavailable", () => {
    const active = renderToStaticMarkup(createElement(PriceAlertRow, { alert, busy: false, planningAvailable: false, onEdit() {}, onChange() {} }));
    const paused = renderToStaticMarkup(createElement(PriceAlertRow, { alert: { ...alert, status: "paused" }, busy: false, planningAvailable: false, onEdit() {}, onChange() {} }));
    expect(active).toContain("ETH above $2,500");
    expect(active).not.toContain(">Edit<");
    expect(active).toContain("Pause");
    expect(paused).toMatch(/<button[^>]*disabled=""[^>]*>Resume<\/button>/);
  });

  it("keeps a committed mutation successful when only the follow-up list refresh fails", async () => {
    let committed = false;
    const result = await commitAndRefresh(async () => { committed = true; }, async () => { throw new Error("network offline"); });
    expect(committed).toBe(true);
    expect(result).toBe("refresh_failed");
    await expect(commitAndRefresh(async () => { throw new Error("mutation failed"); }, async () => {})).rejects.toThrow("mutation failed");
  });
});
