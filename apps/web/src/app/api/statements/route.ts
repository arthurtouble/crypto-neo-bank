import { env } from "cloudflare:workers";
import { z } from "zod";
import { activityItem } from "@/lib/actions/activity";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { listActionsBetween } from "@/lib/actions/store";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  // Guard spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** A month of the customer's Aura activity as CSV. A record of Aura actions, not a bank statement. */
export const GET = route("statements.get", { invalid: "invalid_month", unavailable: "statement_unavailable" }, async (request) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "statement", subject: subject.subjectReference, limit: 20, windowSeconds: 3600 });
  const month = monthSchema.parse(new URL(request.url).searchParams.get("month"));
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const rows = (await listActionsBetween(env.PROJECTION_DB, subject.subjectReference, start, end)).map(activityItem);
  const header = ["Date", "Type", "Status", "Asset", "Amount", "Counterparty", "USD value", "Network", "Transaction"];
  const lines = rows.map((row) => [row.createdAt, row.type, row.status, row.asset, row.amount, row.destination,
    row.estimatedUsd?.toFixed(2), row.chainId, row.transactionHash].map(csvCell).join(","));
  return new Response([header.join(","), ...lines].join("\n") + "\n", { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="aura-${month}.csv"`, "Cache-Control": "no-store" } });
});
