import { z } from "zod";

const subjectReference = z.string().min(3).max(100);
const amount = z.string().regex(/^\d+(\.\d{1,8})?$/, "Use a positive decimal amount").refine((value) => Number(value) > 0, "Amount must be greater than zero");

export const productCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_wallet"), subjectReference }),
  z.object({ type: z.literal("start_compliance"), subjectReference, country: z.string().length(2) }),
  z.object({ type: z.literal("deposit"), subjectReference, amount, asset: z.string().min(2).max(12), rail: z.enum(["bank", "wallet"]) }),
  z.object({ type: z.literal("withdraw"), subjectReference, amount, asset: z.string().min(2).max(12), destinationReference: z.string().min(3).max(160) }),
  z.object({ type: z.literal("allocate"), subjectReference, amount, asset: z.string().min(2).max(12), strategyReference: z.string().min(3).max(100) }),
  z.object({ type: z.literal("issue_card"), subjectReference }),
  z.object({ type: z.literal("set_security_policy"), subjectReference, policy: z.enum(["allowlist", "transfer_delay", "passkey"]), enabled: z.boolean() })
]);

export const commandRequestSchema = z.object({
  scenarioId: z.enum(["new_customer", "funded", "compliance_review", "transfer_failed"]),
  idempotencyKey: z.string().min(8).max(120),
  command: productCommandSchema
});
