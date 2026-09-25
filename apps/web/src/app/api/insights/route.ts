import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { buildInsights, type InsightInput } from "@/lib/insights/presentation";
import { route } from "@/lib/http/route";

type IntentRow = { intent_type: string; status: string; request_json: string; created_at: string };

export const GET = route("insights.get", { unavailable: "insights_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const url = new URL(request.url);
  const requestedDays = Number(url.searchParams.get("days") ?? 30);
  const days = [7, 30, 90, 365].includes(requestedDays) ? requestedDays : 30;
  const rows = await env.PROJECTION_DB.prepare(`SELECT intent_type, status, request_json, created_at FROM transaction_intents
    WHERE subject_reference = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 500`)
    .bind(subject.subjectReference, new Date(Date.now() - 366 * 86_400_000).toISOString()).all<IntentRow>();
  const inputs: InsightInput[] = rows.results.map((row) => {
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(row.request_json) as Record<string, unknown>; } catch { /* ignore malformed historical projections */ }
    return {
      type: row.intent_type,
      status: row.status,
      createdAt: row.created_at,
      amount: typeof data.amount === "string" ? data.amount : undefined,
      asset: typeof data.asset === "string" ? data.asset : undefined,
      estimatedUsd: typeof data.estimatedUsd === "number" ? data.estimatedUsd : undefined
    };
  });
  return Response.json({ ...buildInsights(inputs, new Date(), days), observedAt: new Date().toISOString(), authority: "Derived from completed Aura activity; providers and blockchains remain authoritative", traceId }, { headers: { "Cache-Control": "no-store" } });
});
