import { buildDemoSession } from "@/lib/providers/session";
import { isDemoScenarioId } from "@/lib/providers/scenarios";

export async function GET(request: Request) {
  const scenarioValue = new URL(request.url).searchParams.get("scenario");
  const scenarioId = isDemoScenarioId(scenarioValue) ? scenarioValue : "funded";
  const session = await buildDemoSession(scenarioId);
  return Response.json(session, { headers: { "Cache-Control": "no-store", "X-Aurel-Mode": "demo", "X-Aurel-Data-Authority": "simulated-provider-and-chain" } });
}
