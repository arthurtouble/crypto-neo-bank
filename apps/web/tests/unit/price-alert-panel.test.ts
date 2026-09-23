import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { commitAndRefresh, PriceAlertRow } from "@/components/price-alert-panel";

const alert = { alertId: "a", pairId: "ETH/USD" as const, baseAssetId: "8453:native", quoteAssetId: "iso4217:USD", quoteCurrency: "USD" as const,
  mappingVersion: "kraken-posttrade-eth-usd-v1", direction: "above" as const, threshold: "2500", hysteresisBps: 100,
  cooldownSeconds: 3600, status: "active" as const, thresholdVersion: 1, createdAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:00Z" };

describe("price alert row", () => {
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

  it("keeps a committed mutation successful when only the follow-up list refresh fails", async () => {
    let committed = false;
    const result = await commitAndRefresh(async () => { committed = true; }, async () => { throw new Error("network offline"); });
    expect(committed).toBe(true);
    expect(result).toBe("refresh_failed");
    await expect(commitAndRefresh(async () => { throw new Error("mutation failed"); }, async () => {})).rejects.toThrow("mutation failed");
  });
});
