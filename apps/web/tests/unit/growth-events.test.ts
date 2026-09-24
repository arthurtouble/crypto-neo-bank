import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { publicEventsBatchSchema, recordPublicEvents, retentionDecision } from "@/lib/growth/events";

describe("public growth events", () => {
  const base = { anonymousSessionId: "f5ba9bbc-4318-4fcb-8649-c9b3be2c315e", surface: "/", properties: {} };
  it("accepts bounded public facts", () => expect(publicEventsBatchSchema.parse({ events: [{ ...base, eventName: "landing_viewed" }] }).events).toHaveLength(1));
  it("accepts a waitlist view and no longer accepts a tour view", () => {
    expect(publicEventsBatchSchema.safeParse({ events: [{ ...base, eventName: "waitlist_viewed" }] }).success).toBe(true);
    expect(publicEventsBatchSchema.safeParse({ events: [{ ...base, eventName: "product_tour_viewed" }] }).success).toBe(false);
  });
  it.each(["application_qualified", "invite_issued", "retained_30d", "first_value_completed"])("rejects server fact %s", (eventName) => expect(() => publicEventsBatchSchema.parse({ events: [{ ...base, eventName }] })).toThrow());
  it("rejects unknown properties and cross-origin surfaces", () => {
    expect(() => publicEventsBatchSchema.parse({ events: [{ ...base, eventName: "landing_viewed", surface: "https://example.com", properties: { email: "person@example.com" } }] })).toThrow();
  });
  it("records a public event without an application column", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec("CREATE TABLE growth_events (event_id TEXT PRIMARY KEY, subject_reference TEXT, anonymous_session_id TEXT, event_name TEXT, surface TEXT, campaign_id TEXT, content_id TEXT, properties_json TEXT, occurred_at TEXT)");
    const db = { prepare(sql: string) { return { bind(...values: unknown[]) { return { async run() { sqlite.prepare(sql).run(...values as string[]); return { success: true }; } }; } }; }, async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map((statement) => statement.run())); } } as unknown as D1Database;
    await recordPublicEvents(db, [{ ...base, eventName: "landing_viewed" }]);
    expect((sqlite.prepare("SELECT event_name FROM growth_events").get() as { event_name: string }).event_name).toBe("landing_viewed");
    sqlite.close();
  });
});

describe("retention rule", () => {
  const activationAt = new Date("2026-01-01T00:00:00Z");
  it("does not mature early", () => expect(retentionDecision({ activationAt, now: new Date("2026-01-20T00:00:00Z"), hasMeaningfulEvent: true })).toBe("not_due"));
  it("requires a meaningful return in the day 21–37 window", () => expect(retentionDecision({ activationAt, returnedAt: new Date("2026-01-31T00:00:00Z"), now: new Date("2026-02-01T00:00:00Z"), hasMeaningfulEvent: true })).toBe("retained"));
});
