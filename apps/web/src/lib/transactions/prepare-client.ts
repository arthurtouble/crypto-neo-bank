import { z } from "zod";
import { normalizePreparedCall, type PreparedCallInput } from "./evidence";

export class WalletOutcomeUnknownError extends Error {}

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

type TransferSubmission = {
  accessToken: string;
  intentId: string;
  step: PreparedStepInput;
  simulate: () => Promise<unknown>;
  isReviewCurrent: () => boolean;
  send: () => Promise<{ hash: string }>;
  fetcher?: typeof fetch;
};

/** Broadcast only after simulation and exact server preparation. */
export async function submitPreparedTransfer(input: TransferSubmission): Promise<{ hash: string; stepIndex: 0; reportRecorded: boolean }> {
  if (!["native_transfer", "erc20_transfer"].includes(input.step.semanticAction)) throw new Error("This transaction cannot be prepared as a direct transfer.");
  await input.simulate();
  const [prepared] = await prepareIntentSteps(input.accessToken, input.intentId, [input.step], input.fetcher);
  if (prepared?.stepIndex !== 0) throw new Error("The prepared transfer step is invalid.");
  const expected = await normalizePreparedCall(input.step.call);
  if (prepared.fingerprint.toLowerCase() !== expected.fingerprint.toLowerCase()) throw new Error("The prepared transaction did not match this exact call.");
  if (!input.isReviewCurrent()) throw new Error("This transfer changed. Review it again before continuing.");
  const recheck = await (input.fetcher ?? fetch)("/api/intents/prepare", {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ intentId: input.intentId, stepIndex: 0,
      call: { ...input.step.call, value: String(input.step.call.value) },
      semanticAction: input.step.semanticAction, sourceReference: input.step.sourceReference,
      expectedEffect: input.step.expectedEffect, recheck: true })
  });
  if (!recheck.ok) throw new Error("This transfer changed or expired. Review it again before continuing.");
  const checked = preparedResponse.parse(await recheck.json());
  if (checked.intentId !== input.intentId || checked.stepIndex !== 0
    || checked.fingerprint.toLowerCase() !== expected.fingerprint.toLowerCase()
    || !input.isReviewCurrent()) throw new Error("This transfer changed or expired. Review it again before continuing.");
  let hash: string;
  try { ({ hash } = await input.send()); }
  catch { throw new WalletOutcomeUnknownError("Your wallet did not return a transaction hash. Check its activity before trying again."); }
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash))
    throw new WalletOutcomeUnknownError("Your wallet did not return a valid transaction hash. Check its activity before trying again.");
  let reportRecorded = false;
  try {
    const response = await (input.fetcher ?? fetch)("/api/intents/status", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ intentId: input.intentId, stepIndex: prepared.stepIndex, status: "submitted", transactionHash: hash })
    });
    reportRecorded = response.ok;
  } catch { /* A broadcast hash must not be discarded or represented as a failed send. */ }
  return { hash, stepIndex: 0, reportRecorded };
}
