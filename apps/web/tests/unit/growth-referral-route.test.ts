import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ writes: 0 }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "subject-a" }), AuthenticationError: class AuthenticationError extends Error {} }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare: () => { state.writes++; throw new Error("retired route wrote to D1"); } } } }));

import { GET, POST } from "@/app/api/growth/referrals/route";

it("retires waitlist referrals without writing or issuing a code", async () => {
  state.writes = 0;
  for (const handler of [GET, POST]) {
    const response = await handler(new Request("https://aura.test/api/growth/referrals", { method: handler === POST ? "POST" : "GET" }));
    expect(response.status).toBe(410);
    expect(JSON.stringify(await response.json())).not.toMatch(/referralUrl|invite|code/);
  }
  expect(state.writes).toBe(0);
});
