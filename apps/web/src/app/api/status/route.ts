import { env } from "cloudflare:workers";

type CheckRow = { check_key: string; status: string; details_json: string; checked_at: string };

function publicDetails(value: string): { label?: string; detail?: string; latencyMs?: number } {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      ...(typeof parsed.label === "string" ? { label: parsed.label.slice(0, 80) } : {}),
      ...(typeof parsed.detail === "string" ? { detail: parsed.detail.slice(0, 160) } : {}),
      ...(typeof parsed.latencyMs === "number" && Number.isFinite(parsed.latencyMs) ? { latencyMs: Math.max(0, Math.round(parsed.latencyMs)) } : {})
    };
  } catch { return {}; }
}

export async function GET() {
  const traceId = crypto.randomUUID();
  try {
    const [database, checks, incidents] = await Promise.all([
      env.PROJECTION_DB.prepare("SELECT 1 AS ready").first(),
      env.PROJECTION_DB.prepare("SELECT check_key, status, details_json, checked_at FROM operational_checks WHERE check_key LIKE 'dependency_%' OR check_key = 'scheduled_reconciliation' ORDER BY check_key").all<CheckRow>(),
      env.PROJECTION_DB.prepare("SELECT incident_id, title, status, impact, message, started_at, updated_at, resolved_at FROM incident_updates WHERE published = 1 ORDER BY updated_at DESC LIMIT 20").all()
    ]);
    const components: Array<Record<string, unknown> & { key: string; status: string; checkedAt: string }> = checks.results.map((check) => ({
      ...publicDetails(check.details_json),
      key: check.check_key.replace("dependency_", ""),
      status: ["operational", "configured", "ok", "degraded", "unavailable"].includes(check.status) ? check.status : "unavailable",
      checkedAt: check.checked_at
    }));
    components.unshift({ key: "aurel", label: "Aurel application", status: database ? "operational" : "unavailable", detail: "Product API and operational database", checkedAt: new Date().toISOString() });
    components.push({ key: "privy", label: "Privy authentication", status: process.env.PRIVY_APP_SECRET ? "configured" : "unavailable", detail: "Verified when a customer authenticates", checkedAt: new Date().toISOString() });
    const degraded = components.some((component) => ["degraded", "unavailable"].includes(String(component.status)));
    return Response.json({ status: degraded ? "degraded" : "operational", components, incidents: incidents.results, observedAt: new Date().toISOString(), traceId }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=120" } });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "public_status.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ status: "unavailable", components: [], incidents: [], observedAt: new Date().toISOString(), traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
