import { demoScenarioIds, demoScenarios } from "@/lib/providers/scenarios";

export function GET() {
  return Response.json({ scenarios: demoScenarioIds.map((id) => ({ id, name: demoScenarios[id].name, description: demoScenarios[id].description })) }, { headers: { "Cache-Control": "public, max-age=300" } });
}
