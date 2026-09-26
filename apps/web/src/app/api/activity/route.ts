import { env } from "cloudflare:workers";
import { isAddress } from "viem";
import { activityItem } from "@/lib/actions/activity";
import { checkAction } from "@/lib/actions/check";
import { listActions } from "@/lib/actions/store";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { getAaveBaseActivity } from "@/lib/defi/aave";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const RECHECK_MS = 30_000;
const MAX_CHECKS = 3;

export const GET = route("activity.get", { unavailable: "activity_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "activity_read", subject: subject.subjectReference, limit: 150, windowSeconds: 3600 });
  const address = new URL(request.url).searchParams.get("address");
  if (address && !isAddress(address)) return Response.json({ error: "invalid_address", traceId }, { status: 400 });
  const now = new Date();
  const [stored, protocol] = await Promise.all([
    listActions(env.PROJECTION_DB, subject.subjectReference),
    address ? getAaveBaseActivity(address).catch(() => ({ items: [], partial: false, sourceStatus: "unavailable" as const }))
      : Promise.resolve({ items: [], partial: false, sourceStatus: "none" as const })
  ]);
  // Opening Activity also advances a few open actions, so they settle even if the customer left the send screen.
  const due = stored.filter((action) => (action.status === "submitted" || action.status === "settling") && (action.transactionHash || action.relayReference)
    && (!action.checkedAt || now.getTime() - Date.parse(action.checkedAt) >= RECHECK_MS)).slice(0, MAX_CHECKS);
  const checked = new Map(await Promise.all(due.map(async (action) => [action.id, await checkAction(env.PROJECTION_DB, action, now)] as const)));
  const items = stored.map((action) => activityItem(checked.get(action.id) ?? action));
  const localKeys = new Set(items.filter((item) => item.transactionHash).map((item) => `${item.transactionHash!.toLowerCase()}:${item.type}`));
  const protocolItems = protocol.items.filter((item) => !localKeys.has(`${item.transactionHash.toLowerCase()}:${item.type}`)).map((item) => ({ ...item, intentId: item.id }));
  const merged = [...items, ...protocolItems].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 100);
  return Response.json({
    intents: merged, observations: [], observedAt: now.toISOString(),
    authority: "Aura actions verified against chain receipts, with source-reported Aave activity",
    sources: {
      aurel: { status: "available", count: items.length, authority: "Aura actions" },
      aave: { status: protocol.sourceStatus, count: protocolItems.length, partial: protocol.partial, authority: "Aave Protocol API and Base" }
    },
    traceId
  });
});
