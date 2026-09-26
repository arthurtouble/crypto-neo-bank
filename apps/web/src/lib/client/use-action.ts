"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionInput } from "@/lib/actions/prepare";
import type { Call } from "@/lib/actions/types";
import { ApiError, useApi } from "./api";
import { useAuraWallet, type SignOptions } from "./use-aura-wallet";

export type ActionView = {
  id: string; kind: "transfer" | "earn" | "route"; chainId: number;
  status: "prepared" | "submitted" | "settling" | "confirmed" | "failed" | "expired";
  summary: Record<string, unknown>; calls?: Call[]; usdCents: number | null; transactionHash: string | null;
  destinationChainId: number | null; destinationTransactionHash: string | null; failureReason: string | null;
};

export type ActionPhase = "idle" | "preparing" | "signing" | "tracking" | "done";

const POLL_MS = 4_000;
const terminal = new Set(["confirmed", "failed", "expired"]);
/** Done from the customer's side: finished, or a same-chain action that matched on the chain and only awaits finality. */
export const actionSettled = (action: ActionView) => terminal.has(action.status) || (action.status === "settling" && !action.destinationChainId);

/**
 * Prepare an action on the server, sign its calls as one operation, report
 * the hash, and track it until the chain settles it.
 */
export function useAction(options: { onSettled?: (action: ActionView) => void } = {}) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<ActionPhase>("idle");
  const [action, setAction] = useState<ActionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The wallet may have sent the operation, but Aura never received its hash. */
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const settledRef = useRef(options.onSettled);
  useEffect(() => { settledRef.current = options.onSettled; }, [options.onSettled]);

  /** Sign and track an action prepared by any Aura endpoint (a bank payout, for example). */
  const runPrepared = useCallback(async (prepare: () => Promise<ActionView>, sign: (action: ActionView) => SignOptions) => {
    setError(null); setOutcomeUnknown(false); setAction(null); setPhase("preparing");
    let signing = false;
    try {
      const prepared = await prepare();
      setAction(prepared);
      if (!prepared.calls) throw new Error("This action can't be signed any more.");
      setPhase("signing");
      signing = true;
      const hash = await wallet.sendCalls(prepared.chainId, prepared.calls, sign(prepared));
      signing = false;
      const submitted = (await api<{ action: ActionView }>(`/api/actions/${prepared.id}/submit`, { method: "POST", json: { transactionHash: hash } })).action;
      setAction(submitted);
      setPhase("tracking");
    } catch (reason) {
      const rejected = reason instanceof Error && /reject|denied|cancel|exited/i.test(reason.message);
      if (signing && !rejected) setOutcomeUnknown(true);
      setError(reason instanceof ApiError || reason instanceof Error
        ? rejected ? "You cancelled in your wallet. Nothing was sent." : reason.message
        : "Something went wrong. Try again.");
      setPhase("idle");
    }
  }, [api, wallet]);

  const run = useCallback((input: ActionInput, sign: (action: ActionView) => SignOptions) =>
    runPrepared(async () => (await api<{ action: ActionView }>("/api/actions", { method: "POST", json: input })).action, sign), [api, runPrepared]);

  useEffect(() => {
    if (phase !== "tracking" || !action) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const current = (await api<{ action: ActionView }>(`/api/actions/${action.id}`)).action;
        if (cancelled) return;
        setAction(current);
        if (actionSettled(current)) {
          setPhase("done");
          await queryClient.invalidateQueries();
          settledRef.current?.(current);
          return;
        }
      } catch { /* A failed status read is retried; it never changes the outcome. */ }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [phase, action, api, queryClient]);

  const reset = useCallback(() => { setPhase("idle"); setAction(null); setError(null); setOutcomeUnknown(false); }, []);

  return { run, runPrepared, reset, phase, action, error, outcomeUnknown, busy: phase === "preparing" || phase === "signing", wallet };
}
