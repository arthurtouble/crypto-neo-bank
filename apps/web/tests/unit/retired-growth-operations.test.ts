import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ writes: 0 }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare: () => { state.writes++; throw new Error("A retired endpoint must not write"); } } } }));
vi.mock("@/lib/auth/admin", () => ({ AuthenticationError: class extends Error {}, AuthorizationError: class extends Error {}, requireOperationsAdmin: async () => ({ subjectReference: "admin" }) }));

import { POST as campaign } from "@/app/api/ops/growth/campaigns/route";
import { POST as experiment } from "@/app/api/ops/growth/experiments/route";
import { POST as communication } from "@/app/api/ops/growth/communications/route";
import { GET as publicExperiment } from "@/app/api/growth/experiments/route";

describe("retired growth operations", () => {
  it.each([
    ["campaign", campaign, "/api/ops/growth/campaigns"],
    ["experiment", experiment, "/api/ops/growth/experiments"],
    ["communication", communication, "/api/ops/growth/communications"]
  ])("rejects new %s records", async (_name, handler, path) => {
    state.writes = 0;
    const response = await handler(new Request(`https://aura.test${path}`, { method: "POST", body: "{}" }));
    expect(response.status).toBe(410);
    expect(state.writes).toBe(0);
  });

  it("does not create public experiment assignments", async () => {
    state.writes = 0;
    expect((await publicExperiment()).status).toBe(410);
    expect(state.writes).toBe(0);
  });
});
