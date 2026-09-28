import { env } from "cloudflare:workers";
import { readHistory } from "@/lib/activity/history";
import { entryAmount, entryLabel } from "@/lib/activity/entries";
import { requireActionWallet } from "@/lib/auth/wallet";
import { networkName } from "@/lib/assets/registry";
import { failureText } from "@/lib/client/action-copy";
import { errorResponse, route } from "@/lib/http/route";

/**
 * Intercom's Fin data connector: a customer's latest transactions, so Fin can
 * answer "where's my money?" from real status. Intercom calls it server to
 * server with the shared FIN_CONNECTOR_TOKEN and the user_id from the
 * customer's verified Messenger identity. Read only, the latest 10 entries,
 * no balances. Off unless the token is configured.
 */
function authorized(request: Request): boolean {
  const expected = process.env.FIN_CONNECTOR_TOKEN;
  const given = request.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  if (!expected || expected.length < 32 || given.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ given.charCodeAt(index);
  return difference === 0;
}

export const GET = route("support.fin.activity", { unavailable: "activity_unavailable" }, async (request, context) => {
  if (!authorized(request)) return errorResponse(401, "unauthorized", context);
  const userId = new URL(request.url).searchParams.get("user_id") ?? "";
  if (!/^did:privy:[A-Za-z0-9]{8,64}$/.test(userId)) return errorResponse(400, "invalid_user", context);
  const known = await env.PROJECTION_DB.prepare("SELECT 1 FROM subject_profiles WHERE subject_reference = ?").bind(userId).first();
  if (!known) return errorResponse(404, "unknown_user", context);
  const history = await readHistory(env.PROJECTION_DB, userId, await requireActionWallet(userId));
  const transactions = history.entries.slice(0, 10).map((entry) => ({
    date: entry.createdAt,
    type: entryLabel(entry.type),
    amount: entryAmount(entry),
    network: networkName(entry.chainId),
    ...(entry.destinationChainId ? { arrivesOn: networkName(entry.destinationChainId) } : {}),
    status: entry.status,
    final: entry.final ?? null,
    ...(entry.failureReason ? { whyItFailed: failureText(entry.failureReason) } : {}),
    ...(entry.transactionHash ? { transactionHash: entry.transactionHash } : {})
  }));
  // Fin must say when part of the history couldn't be read, never guess.
  const unavailable = Object.entries(history.sources).filter(([, state]) => state.status === "unavailable").map(([name]) => name);
  return Response.json({ transactions, incomplete: unavailable.length > 0, observedAt: history.observedAt }, { headers: { "Cache-Control": "no-store" } });
});
