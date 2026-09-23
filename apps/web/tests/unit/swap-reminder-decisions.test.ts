import { describe, expect, it } from "vitest";
import { decidePriceAlert, dueSwapReminders, type PriceAlert, type PriceObservation } from "@/lib/swap/reminder-decisions";

const alert: PriceAlert = { pairId: "ETH/USD", baseAssetId: "eip155:8453/native", quoteAssetId: "iso4217:USD", quoteCurrency: "USD", mappingVersion: "catalog-1", thresholdVersion: 1, direction: "above", threshold: "3000.00", hysteresisBps: 100, cooldownSeconds: 3600, status: "active" };
const observation = (price: string, sourceObservedAt = "2026-09-23T10:00:00.000Z", observationId = "obs-1"): PriceObservation => ({ pairId: "ETH/USD", baseAssetId: alert.baseAssetId, quoteAssetId: alert.quoteAssetId, quoteCurrency: "USD", mappingVersion: "catalog-1", price, sourceObservedAt, fetchedAt: new Date(Date.parse(sourceObservedAt) + 5_000).toISOString(), observationId, mappingReviewed: true, assetEligible: true, depegged: false });
const now = new Date("2026-09-23T10:01:00.000Z");

describe("price alert decisions", () => {
  it("rejects invalid threshold and unsupported mapped asset", () => {
    expect(() => decidePriceAlert({ ...alert, threshold: "0" }, null, observation("2990"), now)).toThrow();
    expect(() => decidePriceAlert({ ...alert, threshold: "9".repeat(100_000) }, null, observation("2990"), now)).toThrow();
    expect(decidePriceAlert(alert, null, { ...observation("2990"), assetEligible: false }, now).accepted).toBe(false);
    expect(decidePriceAlert(alert, null, { ...observation("2990"), mappingReviewed: false }, now).accepted).toBe(false);
    expect(decidePriceAlert(alert, null, { ...observation("2990"), mappingVersion: "stale-catalog" }, now).accepted).toBe(false);
  });
  it("uses source observation time rather than fresh fetch time", () => {
    expect(decidePriceAlert(alert, null, { ...observation("2990", "2026-09-23T08:00:00.000Z"), fetchedAt: now.toISOString() }, now).reason).toBe("stale");
  });
  it("baselines already crossed threshold without firing and triggers only on a later edge", () => {
    const baseline = decidePriceAlert(alert, null, observation("3010"), now);
    expect(baseline.trigger).toBe(false);
    const opposite = decidePriceAlert(alert, baseline.next, observation("2960", "2026-09-23T10:02:00.000Z", "obs-2"), new Date("2026-09-23T10:02:10Z"));
    expect(opposite.next?.armed).toBe(true);
    const crossed = decidePriceAlert(alert, opposite.next, observation("3010", "2026-09-23T10:03:00.000Z", "obs-3"), new Date("2026-09-23T10:03:10Z"));
    expect(crossed.trigger).toBe(true);
    expect(crossed.next?.lastTriggeredAt).toBe("2026-09-23T10:03:00.000Z");
  });
  it("rejects repeats and out-of-order observations, including a later fetch", () => {
    const first = decidePriceAlert(alert, null, observation("2990"), now).next;
    expect(decidePriceAlert(alert, first, { ...observation("3100"), fetchedAt: "2026-09-23T10:05:00.000Z" }, new Date("2026-09-23T10:05:05Z")).accepted).toBe(false);
    expect(decidePriceAlert(alert, first, observation("3100", "2026-09-23T09:59:00.000Z", "obs-0"), now).accepted).toBe(false);
    expect(decidePriceAlert(alert, first, observation("3100", "2026-09-23T10:00:00.000Z", "obs-2"), now).accepted).toBe(false);
  });
  it("accepts a later source trade within the same millisecond and preserves its cursor", () => {
    const before = decidePriceAlert(alert, null, observation("2960", "2026-09-23T10:00:00.123456001Z", "obs-a"), now);
    const crossed = decidePriceAlert(alert, before.next, observation("3010", "2026-09-23T10:00:00.123456002Z", "obs-b"), now);
    expect(crossed.trigger).toBe(true);
    expect(crossed.next?.sourceObservedAt).toBe("2026-09-23T10:00:00.123456002Z");
    expect(crossed.next?.lastTriggeredAt).toBe("2026-09-23T10:00:00.123456002Z");
    expect(decidePriceAlert(alert, crossed.next, observation("2960", "2026-09-23T10:00:00.123456001Z", "obs-c"), now).reason).toBe("out_of_order");
  });
  it("requires a genuine opposite side before a zero-hysteresis threshold edge", () => {
    const exact = { ...alert, hysteresisBps: 0 };
    const first = decidePriceAlert(exact, null, observation("3000"), now).next;
    expect(decidePriceAlert(exact, first, observation("3000", "2026-09-23T10:02:00.000Z", "obs-2"), new Date("2026-09-23T10:02:05Z")).trigger).toBe(false);
  });
  it("supports downward crossings and rejects changed pair mapping", () => {
    const downward = { ...alert, direction: "below" as const };
    const first = decidePriceAlert(downward, null, observation("3040"), now).next;
    expect(decidePriceAlert(downward, first, observation("2990", "2026-09-23T10:02:00.000Z", "obs-2"), new Date("2026-09-23T10:02:05Z")).trigger).toBe(true);
    expect(decidePriceAlert(downward, first, { ...observation("2990", "2026-09-23T10:02:00.000Z", "obs-3"), baseAssetId: "eip155:1/native" }, new Date("2026-09-23T10:02:05Z")).accepted).toBe(false);
  });
  it("starts a new threshold version unarmed without replaying an old observation", () => {
    const first = decidePriceAlert(alert, null, observation("2950"), now).next;
    const changed = { ...alert, threshold: "2900", thresholdVersion: 2 };
    expect(decidePriceAlert(changed, first, observation("2950"), now).accepted).toBe(false);
    const baseline = decidePriceAlert(changed, first, observation("2950", "2026-09-23T10:02:00.000Z", "obs-2"), new Date("2026-09-23T10:02:05Z"));
    expect(baseline.trigger).toBe(false);
    expect(baseline.next?.thresholdVersion).toBe(2);
  });
  it("rearms only after hysteresis and does not fire again during cooldown", () => {
    const initial = decidePriceAlert(alert, null, observation("2950"), now).next;
    const fired = decidePriceAlert(alert, initial, observation("3010", "2026-09-23T10:02:00.000Z", "obs-2"), new Date("2026-09-23T10:02:05Z"));
    const noisy = decidePriceAlert(alert, fired.next, observation("2990", "2026-09-23T10:03:00.000Z", "obs-3"), new Date("2026-09-23T10:03:05Z"));
    expect(noisy.next?.armed).toBe(false);
    const rearmed = decidePriceAlert(alert, noisy.next, observation("2960", "2026-09-23T10:04:00.000Z", "obs-4"), new Date("2026-09-23T10:04:05Z"));
    expect(rearmed.next?.armed).toBe(true);
    const cooled = decidePriceAlert(alert, rearmed.next, observation("3020", "2026-09-23T10:05:00.000Z", "obs-5"), new Date("2026-09-23T10:05:05Z"));
    expect(cooled.trigger).toBe(false);
  });
  it("compares high-precision decimal prices without float rounding", () => {
    const precise = { ...alert, threshold: "1.000000000000000001", hysteresisBps: 0 };
    const first = decidePriceAlert(precise, null, observation("1.000000000000000000"), now).next;
    expect(decidePriceAlert(precise, first, observation("1.000000000000000001", "2026-09-23T10:02:00.000Z", "obs-2"), new Date("2026-09-23T10:02:05Z")).trigger).toBe(true);
    expect(() => decidePriceAlert({ ...precise, threshold: "1.0000000000000000001" }, null, observation("1"), now)).toThrow();
  });
});

describe("approval-required recurrence decisions", () => {
  const plan = { scheduleType: "weekly" as const, timeZone: "Europe/Lisbon", anchorLocal: "2026-03-22T09:00", status: "active" as const };
  it("produces one-time, weekly and monthly due reminders without old catch-up", () => {
    expect(dueSwapReminders({ ...plan, scheduleType: "one_time", anchorLocal: "2026-09-23T09:00" }, new Date("2026-09-22T00:00Z"), now).due.map((d) => d.toISOString())).toEqual(["2026-09-23T08:00:00.000Z"]);
    expect(dueSwapReminders(plan, new Date("2026-03-22T09:00Z"), new Date("2026-03-29T09:05Z")).due.map((d) => d.toISOString())).toEqual(["2026-03-29T08:00:00.000Z"]);
    expect(dueSwapReminders({ ...plan, scheduleType: "monthly", timeZone: "UTC", anchorLocal: "2027-01-31T10:00" }, new Date("2027-01-31T10:00Z"), new Date("2027-02-28T11:00Z")).due.map((d) => d.toISOString())).toEqual(["2027-02-28T10:00:00.000Z"]);
    expect(dueSwapReminders({ ...plan, scheduleType: "one_time", anchorLocal: "2026-09-20T09:00" }, new Date("2026-09-19T00:00Z"), now).due).toEqual([]);
  });
  it("uses established DST gap and overlap semantics", () => {
    expect(dueSwapReminders({ ...plan, scheduleType: "one_time", anchorLocal: "2026-03-29T01:30" }, new Date("2026-03-28T00:00Z"), new Date("2026-03-29T02:00Z")).due[0]?.toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(dueSwapReminders({ ...plan, scheduleType: "one_time", anchorLocal: "2026-10-25T01:30" }, new Date("2026-10-24T00:00Z"), new Date("2026-10-25T02:00Z")).due[0]?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
  it("does not materialize paused or cancelled plans", () => {
    expect(dueSwapReminders({ ...plan, status: "paused" }, new Date("2026-03-22T09:00Z"), new Date("2026-03-29T09:05Z")).due).toEqual([]);
    expect(dueSwapReminders({ ...plan, status: "cancelled" }, new Date("2026-03-22T09:00Z"), new Date("2026-03-29T09:05Z")).due).toEqual([]);
  });
});
