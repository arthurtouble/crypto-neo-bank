import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const state = vi.hoisted(() => ({
  AuthenticationError: httpErrors.AuthenticationError,
  authenticated: false,
  calls: 0
}));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {}, AI: {
  run: async () => { state.calls++; return { response: "You can receive USDC at your linked Base address." }; }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: state.AuthenticationError,
  requireVerifiedSubject: async () => { if (!state.authenticated) throw new state.AuthenticationError(); return { subjectReference: "subject-a" }; } }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: httpErrors.FeatureUnavailableError, requireFeature: async (_db: unknown, key: string) => {
  if (key !== "support_assistant") throw new Error("Legacy feature used.");
} }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: httpErrors.RateLimitError, enforceRateLimit: async () => undefined }));

import { POST } from "@/app/api/support/assistant/route";


describe("Aura support assistant", () => {
  it("requires a session before calling Workers AI", async () => {
    state.authenticated = false; state.calls = 0;
    const response = await POST(new Request("https://aura.test/api/support/assistant", { method: "POST", body: JSON.stringify({ question: "How do I receive USDC?" }) }));
    expect(response.status).toBe(401);
    expect(state.calls).toBe(0);
  });

  it("uses the support capability for a signed-in member", async () => {
    state.authenticated = true; state.calls = 0;
    const response = await POST(new Request("https://aura.test/api/support/assistant", { method: "POST", body: JSON.stringify({ question: "How do I receive USDC?" }) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ capabilities: "read-only-explanation-and-drafting" });
    expect(state.calls).toBe(1);
  });
});

it("migrates the old concierge flag to the support assistant without enabling retired flags", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE feature_flags (flag_key TEXT PRIMARY KEY, enabled INTEGER, audience TEXT, configuration_json TEXT, updated_at TEXT, updated_by TEXT)");
    db.exec("INSERT INTO feature_flags VALUES ('concierge', 1, 'all', '{}', '', ''), ('membership_preview', 1, 'all', '{}', '', '')");
    db.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0038_support_assistant_flag.sql"), "utf8"));
    const flags = db.prepare("SELECT flag_key, enabled FROM feature_flags ORDER BY flag_key").all();
    expect(flags).toEqual([{ flag_key: "concierge", enabled: 0 }, { flag_key: "membership_preview", enabled: 0 }, { flag_key: "support_assistant", enabled: 1 }]);
  } finally { db.close(); }
});
