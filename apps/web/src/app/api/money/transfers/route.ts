import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { z } from "zod";

const transferSchema = z.object({
  rail: z.enum(["ach", "wire", "fednow"]),
  direction: z.enum(["deposit", "withdrawal"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  destinationReference: z.string().trim().min(1).max(160).optional()
});

export async function POST(request: Request) {
  try {
    await requireVerifiedSubject(request);
    transferSchema.parse(await request.json());
    return Response.json({
      error: "setup_required",
      message: "Set up bank transfers before moving money.",
      nextAction: { type: "verify_identity", label: "Continue Setup" }
    }, { status: 409, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof AuthenticationError ? 401 : error instanceof z.ZodError ? 400 : 503;
    return Response.json({ error: status === 401 ? "unauthorized" : status === 400 ? "invalid_transfer" : "transfer_unavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
