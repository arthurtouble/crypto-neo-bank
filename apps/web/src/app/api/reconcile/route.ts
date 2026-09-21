import { reconcileSession } from "@/lib/reconciliation";
import { buildDemoSession } from "@/lib/providers/session";
import { isDemoScenarioId } from "@/lib/providers/scenarios";

export async function GET(request: Request) {
  const scenarioValue = new URL(request.url).searchParams.get("scenario");
  const scenarioId = isDemoScenarioId(scenarioValue) ? scenarioValue : "funded";
  const report = reconcileSession(await buildDemoSession(scenarioId));
  return Response.json(report, { headers: { "Cache-Control": "no-store", "X-Aurel-Data-Authority": "provider-and-chain-rebuild" } });
}
