"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionInput } from "@/lib/actions/prepare";
import type { AuthorizationRequest } from "@/lib/actions/privy-relay";
import type { Call } from "@/lib/actions/types";
import { useToast } from "@/components/toast";
import { failureText } from "./action-copy";
import { ApiError, useApi } from "./api";
import { useAuraWallet } from "./use-aura-wallet";

export type ActionView = {
  id: string; kind: "transfer" | "earn" | "route"; chainId: number;
  status: "prepared" | "submitted" | "settling" | "confirmed" | "failed" | "expired";
  summary: Record<string, unknown>; calls?: Call[]; usdCents: number | null; transactionHash: string | null;
  destinationChainId: number | null; destinationTransactionHash: string | null; failureReason: string | null;
};

export type ActionPhase = "idle" | "preparing" | "signing" | "tracking" | "done";

const POLL_MS = 2_000;
const terminal = new Set(["confirmed", "failed", "expired"]);
/** Done from the customer's side: finished, or a same-chain action that matched on the chain and only awaits finality. */
/** Toast key for the passkey prompt, cleared once the customer adds one. */
export const MFA_REQUIRED_TOAST = "mfa-required";

export const actionSettled = (action: ActionView) => terminal.has(action.status) || (action.status === "settling" && !action.destinationChainId);

/**
 * Prepare an action on the server, approve the exact request the server
 * built, let the server relay it with gas paid, and track it until the chain
 * settles it. Errors and outcomes appear as toasts, named by `label`
 * ("Transfer", "Swap").
 */
export function useAction(options: { label?: string; onSettled?: (action: ActionView) => void } = {}) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const toast = useToast();
  const label = options.label ?? "Transaction";
  const labelRef = useRef(label);
  useEffect(() => { labelRef.current = label; }, [label]);
  const [phase, setPhase] = useState<ActionPhase>("idle");
  const [action, setAction] = useState<ActionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The operation may have been sent, but Aura couldn't confirm it. */
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const settledRef = useRef(options.onSettled);
  useEffect(() => { settledRef.current = options.onSettled; }, [options.onSettled]);

  /** Sign and track an action prepared by any Aura endpoint (a bank payout, for example). */
  const runPrepared = useCallback(async (prepare: () => Promise<ActionView>) => {
    setError(null); setOutcomeUnknown(false); setAction(null); setPhase("preparing");
    let signing = false;
    try {
      const prepared = await prepare();
      setAction(prepared);
      if (!prepared.calls) throw new Error("This action can't be signed any more.");
      setPhase("signing");
      const { request } = await api<{ request: AuthorizationRequest }>(`/api/actions/${prepared.id}/authorize`, { method: "POST" });
      const signature = await wallet.authorize(request);
      signing = true;
      const submit = () => api<{ action: ActionView }>(`/api/actions/${prepared.id}/submit`, { method: "POST", json: { signature } });
      // An unconfirmed relay is retried once with the same signed request, which Privy won't send twice.
      const submitted = (await submit().catch(async (reason) => {
        if (!(reason instanceof ApiError) || reason.code !== "relay_unconfirmed") throw reason;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        return submit();
      })).action;
      signing = false;
      setAction(submitted);
      setPhase("tracking");
      // Balances start changing as soon as the operation lands; refresh them without waiting for it to settle.
      void queryClient.invalidateQueries();
    } catch (reason) {
      setPhase("idle");
      if (reason instanceof ApiError && reason.code === "mfa_required") {
        // Nothing was prepared or sent. Open Privy's setup so the customer can add a passkey and try again.
        setError(reason.message);
        toast.show({ tone: "error", key: MFA_REQUIRED_TOAST, sticky: true, title: "Add a passkey to move money",
          detail: "Nothing was sent. Add a passkey or authenticator app in the window that opened, then try again." });
        wallet.enrollPasskey();
        return;
      }
      const rejected = reason instanceof Error && /reject|denied|cancel|exited/i.test(reason.message);
      // Privy refusing the signed request is definite: nothing was sent. Only an unanswered relay leaves the outcome unknown.
      const refused = reason instanceof ApiError && reason.code === "relay_rejected";
      if (signing && !rejected && !refused) {
        setOutcomeUnknown(true);
        setError("Your wallet may have sent this. Check Transactions before you try again.");
        toast.show({ tone: "error", sticky: true, title: "Check Transactions first",
          detail: "Your wallet may have sent this. Check Transactions before you try again.", link: { label: "Open Transactions", href: "/app/transactions" } });
        return;
      }
      if (rejected) {
        setError("You cancelled. Nothing was sent.");
        toast.show({ tone: "info", title: "Cancelled", detail: "Nothing was sent." });
        return;
      }
      const message = reason instanceof ApiError || reason instanceof Error ? reason.message : "Something went wrong. Try again.";
      setError(message);
      toast.error(`${labelRef.current} not sent`, message);
    }
  }, [api, wallet, queryClient, toast]);

  const run = useCallback((input: ActionInput) =>
    runPrepared(async () => (await api<{ action: ActionView }>("/api/actions", { method: "POST", json: input })).action), [api, runPrepared]);

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
          const name = labelRef.current;
          if (current.status === "failed") toast.error(`${name} failed`, failureText(current.failureReason));
          else if (current.status === "expired") toast.error(`${name} not confirmed`, "We didn't receive it in time. If you confirmed it, check Transactions.");
          else toast.success(current.status === "confirmed" || current.destinationChainId ? `${name} complete` : `${name} sent`);
          await queryClient.invalidateQueries();
          settledRef.current?.(current);
          return;
        }
      } catch { /* A failed status read is retried; it never changes the outcome. */ }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [phase, action, api, queryClient, toast]);

  const reset = useCallback(() => { setPhase("idle"); setAction(null); setError(null); setOutcomeUnknown(false); }, []);

  return { run, runPrepared, reset, phase, action, error, outcomeUnknown, busy: phase === "preparing" || phase === "signing", wallet };
}
