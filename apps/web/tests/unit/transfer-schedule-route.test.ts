import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ authorized: true, beta: true, feature: true, locked: false, cooled: true, status: "approval_required", scheduleType: "one_time", dueAt: "2026-01-01T09:00:00.000Z", nextRunAt: "2026-01-01T09:00:00.000Z", occurrence: false, inserts: 0, seenDue: new Set<string>(), scheduleInsertValues: [] as unknown[] }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare(sql: string) {
  const query = { values: [] as unknown[], bind(...values: unknown[]) { this.values = values; return this; },
    async first() {
      if (sql.includes("schedule_occurrences") && sql.includes("JOIN")) return state.occurrence ? { occurrence_id: "occ-1", schedule_id: "sched-1", subject_reference: "subject-a", due_at: state.dueAt, reminder_state: "due", status: state.status, destination_kind: "wallet", provider: null, destination_reference: "0x1111111111111111111111111111111111111111", asset: "USDC", amount: "10" } : null;
      if (sql.includes("FROM transfer_schedules") && sql.includes("SELECT status")) return { status: state.status, provider: null, schedule_type: state.scheduleType, time_zone: "UTC", anchor_local: "2026-01-01T09:00" };
      if (sql.includes("security_profiles")) return { account_locked: Number(state.locked) };
      if (sql.includes("address_book_entries")) return { available_at: state.cooled ? "2020-01-01T00:00:00Z" : "2099-01-01T00:00:00Z" };
      return null;
    },
    async all() {
      if (sql.includes("FROM transfer_schedules")) return { results: [{ schedule_id: "sched-1", subject_reference: "subject-a", schedule_type: state.scheduleType, destination_kind: "wallet", destination_reference: "0x1111111111111111111111111111111111111111", destination_label: "Alice", asset: "USDC", amount: "10", next_run_at: state.nextRunAt, status: state.status, provider: null, time_zone: "UTC", anchor_local: "2026-01-01T09:00" }] };
      if (sql.includes("FROM schedule_occurrences")) return { results: state.occurrence ? [{ occurrence_id: "occ-1", schedule_id: "sched-1", due_at: state.dueAt, reminder_state: "due", destination_label: "Alice", destination_reference: "0x1111111111111111111111111111111111111111", asset: "USDC", amount: "10", time_zone: "UTC" }] : [] };
      return { results: [] };
    },
    async run() { if (sql.includes("INSERT OR IGNORE INTO schedule_occurrences")) { const due = String(this.values[1]); if (!state.seenDue.has(due)) { state.inserts++; state.seenDue.add(due); } state.occurrence = true; } if (sql.includes("UPDATE transfer_schedules SET next_run_at")) state.nextRunAt = String(this.values[0]); if (sql.includes("INSERT INTO transfer_schedules")) state.scheduleInsertValues = this.values; return { meta: { changes: 1 } }; }
  }; return query;
} } } }));
vi.mock("@/lib/auth/server", () => { class AuthenticationError extends Error {} return { AuthenticationError, requireVerifiedSubject: async () => { if (!state.authorized) throw new AuthenticationError(); return { subjectReference: "subject-a" }; } }; });
vi.mock("@/lib/beta/access", () => { class BetaAccessError extends Error { code = "invite_required"; } return { BetaAccessError, requireBetaAccess: async () => { if (!state.beta) throw new BetaAccessError(); } }; });
vi.mock("@/lib/features/flags", () => { class FeatureUnavailableError extends Error {} return { FeatureUnavailableError, requireFeature: async () => { if (!state.feature) throw new FeatureUnavailableError(); } }; });
vi.mock("@/lib/security/audit", () => ({ writeAuditEvent: async () => undefined }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => undefined }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));

import { GET, POST } from "@/app/api/transfer-schedules/due/route";
import { POST as createSchedule, PATCH as changeSchedule } from "@/app/api/transfer-schedules/route";

beforeEach(() => Object.assign(state, { authorized: true, beta: true, feature: true, locked: false, cooled: true, status: "approval_required", scheduleType: "one_time", dueAt: "2026-01-01T09:00:00.000Z", nextRunAt: "2026-01-01T09:00:00.000Z", occurrence: false, inserts: 0, seenDue: new Set<string>(), scheduleInsertValues: [] }));
const get = () => GET(new Request("https://aurel.test/api/transfer-schedules/due"));
const review = () => POST(new Request("https://aurel.test/api/transfer-schedules/due", { method: "POST", body: JSON.stringify({ occurrenceId: "occ-1" }) }));

describe("scheduled transfer reminders", () => {
  it("stores a literal local wall time and IANA zone, rejecting an account lock", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    const request = () => new Request("https://aurel.test/api/transfer-schedules", { method: "POST", body: JSON.stringify({ scheduleType: "weekly", destinationKind: "wallet", destinationReference: "0x1111111111111111111111111111111111111111", destinationLabel: "Alice", asset: "USDC", amount: "10", timeZone: "UTC", anchorLocal: tomorrow }) });
    state.locked = true; expect((await createSchedule(request())).status).toBe(423);
    state.locked = false; expect((await createSchedule(request())).status).toBe(201);
    expect(state.scheduleInsertValues).toContain("UTC");
    expect(state.scheduleInsertValues).toContain(tomorrow);
  });
  it("rejects a malformed wallet destination before saving a schedule", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    const response = await createSchedule(new Request("https://aurel.test/api/transfer-schedules", { method: "POST", body: JSON.stringify({ scheduleType: "weekly", destinationKind: "wallet", destinationReference: "not-a-wallet", destinationLabel: "Alice", asset: "USDC", amount: "10", timeZone: "UTC", anchorLocal: tomorrow }) }));
    expect(response.status).toBe(400);
  });
  it("recomputes a future occurrence when resuming an old paused schedule", async () => {
    state.status = "paused";
    state.scheduleType = "weekly";
    const response = await changeSchedule(new Request("https://aurel.test/api/transfer-schedules", { method: "PATCH", body: JSON.stringify({ scheduleId: "00000000-0000-4000-8000-000000000001", action: "resume" }) }));
    expect(response.status).toBe(200);
    const body = await response.json() as { nextRunAt: string };
    expect(new Date(body.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });
  it("requires an authenticated subject", async () => { state.authorized = false; expect((await get()).status).toBe(401); expect((await review()).status).toBe(401); });
  it("materializes a due occurrence idempotently without sending money", async () => {
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(200);
    expect(state.inserts).toBe(1);
  });
  it("catches up no more than twelve overdue periods in one read", async () => {
    state.scheduleType = "weekly";
    expect((await get()).status).toBe(200);
    expect(state.inserts).toBe(12);
  });
  it("blocks review after a pause or cancellation, or when recipient cooling restarts", async () => {
    state.occurrence = true;
    state.status = "paused"; expect((await review()).status).toBe(409);
    state.status = "cancelled"; expect((await review()).status).toBe(409);
    state.status = "approval_required"; state.cooled = false; expect((await review()).status).toBe(409);
  });
  it("blocks review for account lock, beta loss, or a disabled transfer flag", async () => {
    state.occurrence = true;
    state.locked = true; expect((await review()).status).toBe(423);
    state.locked = false; state.beta = false; expect((await review()).status).toBe(403);
    state.beta = true; state.feature = false; expect((await review()).status).toBe(503);
  });
  it("returns only a direct-send review link, never a payment result", async () => {
    state.occurrence = true;
    const response = await review();
    expect(response.status).toBe(200);
    const body = await response.json() as { reviewUrl: string; transactionHash?: string };
    expect(body.reviewUrl).toBe("/app/assets?sendTo=0x1111111111111111111111111111111111111111&asset=USDC");
    expect(body.transactionHash).toBeUndefined();
  });
});
