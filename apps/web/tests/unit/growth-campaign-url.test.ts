import { expect, it, vi } from "vitest";

vi.mock("@/lib/auth/admin", () => ({ requireOperationsAdmin: async () => ({ subjectReference: "operator-a" }), AuthenticationError: class AuthenticationError extends Error {}, AuthorizationError: class AuthorizationError extends Error {} }));
vi.mock("@/lib/security/audit", () => ({ writeAuditEvent: async () => undefined }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare: () => ({ bind() { return this; }, async run() { return { success: true }; } }) } } }));

import { POST } from "@/app/api/ops/growth/campaigns/route";

it("returns a waitlist campaign URL", async () => {
  const response = await POST(new Request("https://aurel.test/api/ops/growth/campaigns", { method: "POST", body: JSON.stringify({ slug: "partner-one", name: "Partner one", campaignType: "partner", approvedCountries: [], status: "draft" }) }));
  expect(response.status).toBe(201);
  const body = await response.json() as { waitlistUrl?: string; applicationUrl?: string };
  expect(body.waitlistUrl).toBe("https://aurel.test/waitlist?partner=partner-one&utm_campaign=partner-one");
  expect(body.applicationUrl).toBeUndefined();
});
