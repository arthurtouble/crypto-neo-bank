import { env } from "cloudflare:workers";
import { z } from "zod";
import { entriesCsv } from "@/lib/activity/entries";
import { readPeriod } from "@/lib/activity/history";
import { networkName } from "@/lib/assets/registry";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * A month of the customer's activity as CSV: Aura actions, money that
 * arrived without one, and card payments. It is complete or it isn't given:
 * if incoming transfers or card payments can't all be read, the statement is
 * refused rather than short.
 * A record of activity, not a bank statement.
 */
export const GET = route("statements.get", { invalid: "invalid_month", unavailable: "statement_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "statement", subject: subject.subjectReference, limit: 20, windowSeconds: 3600 });
  const month = monthSchema.parse(new URL(request.url).searchParams.get("month"));
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const wallet = await requireActionWallet(subject.subjectReference);
  const { entries, complete } = await readPeriod(env.PROJECTION_DB, subject.subjectReference, wallet, start, end);
  if (!complete) return Response.json({ error: "statement_incomplete", message: "Some of that month's activity can't be read right now, so the statement would be incomplete. Try again later.", traceId }, { status: 503 });
  return new Response(entriesCsv(entries, networkName), { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="aura-statement-${month}.csv"`, "Cache-Control": "no-store" } });
});
