import { env } from "cloudflare:workers";
import { readCurrentEntitlements, readMembership } from "@aurel/provider-projections";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";

export const GET = route("rewards.get", { unavailable: "rewards_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const [membership, entitlements] = await Promise.all([
    readMembership(env.PROJECTION_DB, subject.subjectReference),
    readCurrentEntitlements(env.PROJECTION_DB, subject.subjectReference)
  ]);
  return Response.json({
    membership, entitlements,
    state: membership || entitlements.length ? "observed" : "not_connected",
    authority: "Benefit-provider entitlements and a rebuildable qualification result; neither holds or moves money",
    traceId
  });
});
