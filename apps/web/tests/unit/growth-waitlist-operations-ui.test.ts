import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ user: { id: "admin" }, getAccessToken: async () => "token" }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => ({
  isPending: false,
  data: queryKey[0] === "growth-queue" ? { applications: [] } : queryKey[0] === "growth-funnel" ? { counts: {}, denominators: {}, timing: {}, guardrails: {}, breakdown: [] } : { entries: [{ waitlistId: "wait-1", email: "person@example.com", countryHint: "PT", countryHintLabel: "Approximate", status: "waiting", createdAt: "2026-09-23T00:00:00.000Z" }] }
}) }));
vi.mock("@/components/growth-registry", () => ({ GrowthRegistry: () => null }));

import { GrowthOperations } from "@/components/growth-operations";

it("shows a simple waitlist queue and labels IP country as approximate", () => {
  const html = renderToString(createElement(GrowthOperations));
  expect(html).toContain("Waitlist");
  expect(html).toContain("Approximate");
  expect(html).not.toContain("Primary job");
  expect(html).not.toContain("Private-access pipeline");
});
