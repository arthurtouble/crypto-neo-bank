import { z } from "zod";
import type { PreparedCallInput } from "./evidence";

export type PreparedStepInput = {
  call: PreparedCallInput;
  semanticAction: string;
  sourceReference: string;
  expectedEffect: Record<string, unknown>;
};

export type PreparedStep = { stepIndex: number; fingerprint: string };

const preparedResponse = z.object({
  intentId: z.string().uuid(),
  stepIndex: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
});

/** Prepare each exact call before opening any wallet confirmation. */
export async function prepareIntentSteps(
  accessToken: string,
  intentId: string,
  steps: readonly PreparedStepInput[],
  fetcher: typeof fetch = fetch
): Promise<PreparedStep[]> {
  if (!accessToken || !z.string().uuid().safeParse(intentId).success || steps.length < 1 || steps.length > 8) {
    throw new Error("The transaction cannot be prepared.");
  }
  const prepared: PreparedStep[] = [];
  for (const [stepIndex, step] of steps.entries()) {
    const response = await fetcher("/api/intents/prepare", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        intentId,
        stepIndex,
        call: { ...step.call, value: String(step.call.value) },
        semanticAction: step.semanticAction,
        sourceReference: step.sourceReference,
        expectedEffect: step.expectedEffect
      })
    });
    if (!response.ok) throw new Error("The transaction could not be prepared. Review it again before continuing.");
    const result = preparedResponse.parse(await response.json());
    if (result.intentId !== intentId || result.stepIndex !== stepIndex) throw new Error("The prepared transaction did not match this review.");
    prepared.push({ stepIndex, fingerprint: result.fingerprint });
  }
  return prepared;
}
