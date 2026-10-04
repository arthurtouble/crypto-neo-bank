import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { loadControls } from "@/lib/actions/controls";
import { pausedAssets } from "@/lib/assets/pauses";
import { assetsFor } from "@/lib/assets/registry";
import { featureEnabled } from "@/lib/features/flags";
import { route } from "@/lib/http/route";

/**
 * What would stop a send, for the Send page to say before the customer fills anything in: the send and
 * other-network switches, the customer's own controls (lock, saved recipients only, what the daily limit leaves
 * today), and paused assets. The quote and the action check every one of these again on the server.
 */
export const GET = route("send.methods", { unavailable: "send_methods_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const [sending, otherNetworks, controls, paused] = await Promise.all([featureEnabled(env.PROJECTION_DB, "direct_transfers"),
    featureEnabled(env.PROJECTION_DB, "cross_chain"), loadControls(env.PROJECTION_DB, subject.subjectReference, null, new Date()),
    pausedAssets(env.PROJECTION_DB)]);
  const limit = controls.dailyLimitCents;
  return Response.json({
    sending, otherNetworks,
    accountLocked: controls.accountLocked,
    savedRecipientsOnly: controls.enforceAddressBook,
    // Dollars left under the daily limit in the last 24 hours; null when there's no limit, or when a recent send has
    // no value and the server can't count it (it then refuses limited sends, and says why).
    dailyLimitUsd: limit === null ? null : limit / 100,
    leftTodayUsd: limit === null || controls.spentUnknown ? null : Math.max(0, limit - controls.spentCents) / 100,
    pausedAssets: assetsFor("send").filter((asset) => paused.has(asset.id)).map((asset) => asset.id),
    traceId
  }, { headers: { "Cache-Control": "no-store" } });
});
