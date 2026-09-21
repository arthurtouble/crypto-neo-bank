import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { prepareAaveBaseAction } from "@/lib/defi/aave";

const actionSchema = z.object({
  action: z.enum(["supply", "borrow", "withdraw", "repay"]),
  sender: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  symbol: z.enum(["USDC", "WETH"]),
  amount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  max: z.boolean().optional(),
  enableCollateral: z.boolean().optional()
}).refine((value) => Boolean(value.amount) !== Boolean(value.max), { message: "Provide either amount or max." });

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireVerifiedSubject(request);
    const input = actionSchema.parse(await request.json());
    const result = await prepareAaveBaseAction(input);
    return Response.json({ ...result, traceId }, { headers: { "Cache-Control": "no-store", "X-Aurel-Execution": "unsigned-user-confirmation-required" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_action", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "aave.action.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "action_unavailable", message: error instanceof Error ? error.message : "Aave could not prepare the action.", traceId }, { status: 422 });
  }
}

