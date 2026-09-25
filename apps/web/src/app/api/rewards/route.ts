import { env } from "cloudflare:workers";
import { readCurrentEntitlements, readMembership } from "@aurel/provider-projections";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { featureEnabled } from "@/lib/features/flags";
import { route } from "@/lib/http/route";

export const GET = route("rewards.get", { unavailable: "rewards_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  // Rewards come from the card program, so they show only while cards are switched on.
  if (!await featureEnabled(env.PROJECTION_DB, "payment_cards")) {
    return Response.json({ membership: null, entitlements: [], state: "not_connected", authority: "Card program not connected", traceId });
  }
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
