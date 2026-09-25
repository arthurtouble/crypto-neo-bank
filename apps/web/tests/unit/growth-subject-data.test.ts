import { describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "subject-a" }), AuthenticationError: httpErrors.AuthenticationError }));
vi.mock("@/lib/auth/admin", () => ({ requireOperationsAdmin: async () => ({ subjectReference: "operator-a" }), AuthenticationError: httpErrors.AuthenticationError, AuthorizationError: httpErrors.AuthorizationError }));
vi.mock("@/lib/security/audit", () => ({ writeAuditEvent: async () => undefined }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) {
    if (/growth_(applications|subject_links|events|communications|retention_runs|referrals|invite_links|experiment_assignments)\b|application_id/.test(sql)) throw new Error(`retired schema was queried: ${sql}`);
    return { bind() { return this; }, async first() { return sql.includes("FROM growth_data_requests WHERE request_id") ? { request_id: "request-1", subject_reference: "subject-a", request_type: "export", status: "received" } : null; }, async run() { return { success: true }; }, async all() { return { results: [] }; } };
  },
  async batch(statements: Array<{ all(): Promise<unknown> }>) { return Promise.all(statements.map((statement) => statement.all())); }
} } }));

import { POST as requestData } from "@/app/api/growth/data-requests/route";
import { POST as withdrawConsent } from "@/app/api/growth/consent/route";
import { GET as listDataRequests } from "@/app/api/ops/growth/data-requests/route";
import { PATCH as processDataRequest } from "@/app/api/ops/growth/data-requests/[requestId]/route";


describe("subject growth data without application records", () => {
  it("accepts an authenticated deletion request", async () => {
    const response = await requestData(new Request("https://aurel.test/api/growth/data-requests", { method: "POST", body: JSON.stringify({ requestType: "delete" }) }));
    expect(response.status).toBe(202);
  });

  it("records consent withdrawal with subject ID only", async () => {
    const response = await withdrawConsent(new Request("https://aurel.test/api/growth/consent", { method: "POST", body: JSON.stringify({ purpose: "marketing", action: "withdrawn", noticeVersion: "2026-09-23" }) }));
    expect(response.status).toBe(200);
  });

  it("lists subject data requests for an authenticated operator", async () => {
    const response = await listDataRequests(new Request("https://aurel.test/api/ops/growth/data-requests"));
    expect(response.status).toBe(200);
  });

  it("exports subject records without looking for an application", async () => {
    const response = await processDataRequest(new Request("https://aurel.test/api/ops/growth/data-requests/request-1", { method: "PATCH", body: JSON.stringify({ action: "export" }) }), { params: Promise.resolve({ requestId: "00000000-0000-4000-8000-000000000001" }) });
    expect(response.status).toBe(200);
    expect((await response.json() as { export: unknown }).export).toEqual({ consent: [] });
  });
});
