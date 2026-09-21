import { executeDemoCommand } from "@/lib/providers/session";
import { commandRequestSchema } from "@/lib/providers/validation";

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const payload = commandRequestSchema.parse(await request.json());
    const receipt = await executeDemoCommand(payload.scenarioId, payload.command, payload.idempotencyKey);
    console.log(JSON.stringify({ message: "demo command evaluated", traceId, commandType: payload.command.type, status: receipt.status }));
    return Response.json({ receipt, authoritativeBalanceChanged: false, traceId }, { status: receipt.status === "failed" ? 422 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid command";
    console.error(JSON.stringify({ message: "demo command rejected", traceId, error: message }));
    return Response.json({ error: "invalid_command", message, traceId }, { status: 400 });
  }
}
