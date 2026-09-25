import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";

const transferSchema = z.object({
  rail: z.enum(["ach", "wire", "fednow"]),
  direction: z.enum(["deposit", "withdrawal"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  destinationReference: z.string().trim().min(1).max(160).optional()
});

export const POST = route("money.transfers", { invalid: "invalid_transfer", unavailable: "transfer_unavailable" }, async (request: Request) => {
  await requireVerifiedSubject(request);
  transferSchema.parse(await request.json());
  return Response.json({
    error: "setup_required",
    message: "Set up bank transfers before moving money.",
    nextAction: { type: "verify_identity", label: "Continue Setup" }
  }, { status: 409 });
});
