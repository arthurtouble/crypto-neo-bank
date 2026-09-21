import { SandboxLab } from "@/components/sandbox-lab";
import { demoScenarioIds, demoScenarios } from "@/lib/providers/scenarios";
import { buildDemoSession } from "@/lib/providers/session";

export default async function SandboxPage() {
  const initialSession = await buildDemoSession("funded");
  const scenarios = demoScenarioIds.map((id) => ({ id, name: demoScenarios[id].name, description: demoScenarios[id].description }));
  return <SandboxLab initialSession={initialSession} initialScenarios={scenarios} />;
}
