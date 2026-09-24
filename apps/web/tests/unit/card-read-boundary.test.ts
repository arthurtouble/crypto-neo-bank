import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare() { return { bind() { return { async first() { return { provider: "rain", status: "active", last_four: "1234" }; } }; } }; }
} } }));
vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: "subject-a" })
}));

import { GET } from "@/app/api/cards/route";

describe("card read boundary", () => {
  it("does not show a stored card projection as live without an issuer connection", async () => {
    const response = await GET(new Request("https://aura.test/api/cards"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "setup_required", card: null,
      controls: { freeze: "setup_required", terminate: "setup_required" } });
  });
});
