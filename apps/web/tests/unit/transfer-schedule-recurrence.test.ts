import { describe, expect, it } from "vitest";
import { nextOccurrence } from "@/lib/schedules/recurrence";

describe("approval-only schedule recurrence", () => {
  it("emits a one-time instant once", () => {
    const input = { scheduleType: "one_time" as const, timeZone: "Europe/Lisbon", anchorLocal: "2026-10-01T09:30" };
    expect(nextOccurrence({ ...input, after: new Date("2026-09-30T00:00:00Z") })?.toISOString()).toBe("2026-10-01T08:30:00.000Z");
    expect(nextOccurrence({ ...input, after: new Date("2026-10-01T08:30:00Z") })).toBeNull();
  });

  it("keeps weekly wall time over the spring DST transition", () => {
    const input = { scheduleType: "weekly" as const, timeZone: "Europe/Lisbon", anchorLocal: "2026-03-22T09:00" };
    expect(nextOccurrence({ ...input, after: new Date("2026-03-22T09:00:00Z") })?.toISOString()).toBe("2026-03-29T08:00:00.000Z");
  });

  it("clamps February but restores the monthly 31st anchor in March", () => {
    const input = { scheduleType: "monthly" as const, timeZone: "UTC", anchorLocal: "2027-01-31T10:00" };
    expect(nextOccurrence({ ...input, after: new Date("2027-01-31T10:00:00Z") })?.toISOString()).toBe("2027-02-28T10:00:00.000Z");
    expect(nextOccurrence({ ...input, after: new Date("2027-02-28T10:00:00Z") })?.toISOString()).toBe("2027-03-31T10:00:00.000Z");
  });

  it("moves a nonexistent spring wall time to the first valid minute", () => {
    expect(nextOccurrence({ scheduleType: "one_time", timeZone: "Europe/Lisbon", anchorLocal: "2026-03-29T01:30", after: new Date("2026-03-28T00:00:00Z") })?.toISOString()).toBe("2026-03-29T01:00:00.000Z");
  });

  it("selects the earlier UTC instant for an ambiguous fall wall time", () => {
    expect(nextOccurrence({ scheduleType: "one_time", timeZone: "Europe/Lisbon", anchorLocal: "2026-10-25T01:30", after: new Date("2026-10-24T00:00:00Z") })?.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("rejects invalid local dates and unsupported timezones", () => {
    expect(() => nextOccurrence({ scheduleType: "weekly", timeZone: "Mars/Base", anchorLocal: "2026-09-22T09:00", after: new Date("2026-09-21T00:00:00Z") })).toThrow();
    expect(() => nextOccurrence({ scheduleType: "weekly", timeZone: "UTC", anchorLocal: "2026-02-30T09:00", after: new Date("2026-02-01T00:00:00Z") })).toThrow();
  });
});
