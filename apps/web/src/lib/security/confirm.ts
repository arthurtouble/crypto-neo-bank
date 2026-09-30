import { requireMoneyAccount } from "@/lib/auth/wallet";
import { completeStepUp, createStepUp, type Confirmation, type StepUpPurpose } from "./step-up";

/**
 * Ask for a fresh passkey confirmation of exactly `payload`, or check one.
 * Without a confirmation it returns the 428 answer the app signs and sends
 * back; with one it checks it (throwing if it's wrong) and returns null.
 */
export async function confirmWithPasskey(db: D1Database, input: { subject: string; purpose: StepUpPurpose; payload: unknown; summary: string;
  confirmation?: Confirmation; traceId: string }): Promise<Response | null> {
  // Only a passkey (or authenticator app) makes the confirmation meaningful.
  const account = await requireMoneyAccount(input.subject);
  if (!input.confirmation) {
    const challenge = await createStepUp(db, input.subject, account, input.purpose, input.payload, input.summary);
    return Response.json({ error: "confirmation_required", message: `Confirm with your passkey to ${input.summary}.`, ...challenge, traceId: input.traceId }, { status: 428 });
  }
  await completeStepUp(db, input.subject, account, input.purpose, input.payload, input.confirmation);
  return null;
}
