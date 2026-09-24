import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  AuthenticationError: class AuthenticationError extends Error {},
  authenticated: true,
  writes: 0
}));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare: () => ({ bind: () => ({ first: async () => ({ status: "active" }), run: async () => { state.writes++; return { meta: { changes: 1 } }; } }) })
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: state.AuthenticationError,
  requireVerifiedSubject: async () => { if (!state.authenticated) throw new state.AuthenticationError(); return { subjectReference: "subject-a" }; } }));
vi.mock("@/lib/security/audit", () => ({ writeAuditEvent: async () => undefined }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => undefined }));

import { POST as goalCreate, PATCH as goalUpdate } from "@/app/api/goals/route";
import { POST as incomeCreate, PATCH as incomeUpdate } from "@/app/api/income-plan/route";

const request = (path: string, method: string, body: object) => new Request(`https://aura.test${path}`, {
  method, body: JSON.stringify(body)
});

describe("retired planning routes", () => {
  it.each([
    ["goal", goalCreate, "/api/goals", { name: "Trip", targetAmount: "100", targetAsset: "USD" }],
    ["income", incomeCreate, "/api/income-plan", { mode: "next_income", spendingPercent: 100, goalsPercent: 0, earnPercent: 0 }]
  ])("does not create a new %s plan", async (_name, handler, path, body) => {
    state.authenticated = true; state.writes = 0;
    const response = await handler(request(path, "POST", body));
    expect(response.status).toBe(410);
    expect(state.writes).toBe(0);
  });

  it.each([
    ["goal", goalUpdate, "/api/goals", { goalId: "00000000-0000-4000-8000-000000000001", action: "resume" }],
    ["income", incomeUpdate, "/api/income-plan", { planId: "00000000-0000-4000-8000-000000000001", action: "resume" }]
  ])("does not resume a retired %s plan", async (_name, handler, path, body) => {
    state.authenticated = true; state.writes = 0;
    const response = await handler(request(path, "PATCH", body));
    expect(response.status).toBe(400);
    expect(state.writes).toBe(0);
  });
});
