import { env } from "cloudflare:workers";
import { entryAmount, entryLabel, statusLabel } from "@/lib/activity/entries";
import { readHistory } from "@/lib/activity/history";
import { requireOperator } from "@/lib/auth/access";
import { requireActionWallet } from "@/lib/auth/wallet";
import { errorResponse, route } from "@/lib/http/route";

/**
 * Everything that moved money on one customer's account, as the customer sees
 * it in Transactions: their Aura actions, money received from outside Aura
 * (read from the chain), card payments (Stripe), and Aave history. Each source
 * says whether it could be read.
 */
export const GET = route("ops.customers.history", { unavailable: "history_unavailable" }, async (request, context, { params }: { params: Promise<{ subject: string }> }) => {
  await requireOperator(request);
  const subject = decodeURIComponent((await params).subject);
  if (!subject.startsWith("did:privy:") || subject.length > 200) return errorResponse(400, "invalid_subject", context, { message: "That isn't a customer ID." });
  const wallet = await requireActionWallet(subject);
  const history = await readHistory(env.PROJECTION_DB, subject, wallet);
  return Response.json({
    wallet, sources: history.sources, observedAt: history.observedAt, traceId: context.traceId,
    entries: history.entries.map((entry) => ({ ...entry, label: entryLabel(entry.type), amountText: entryAmount(entry) ?? null, statusText: statusLabel(entry.status) }))
  }, { headers: { "Cache-Control": "no-store" } });
});
