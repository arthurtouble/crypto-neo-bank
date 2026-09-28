"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { networkName } from "@/lib/assets/registry";
import { failureText } from "@/lib/client/action-copy";
import type { ActionView } from "@/lib/client/use-action";

export type ActionEvent = { type: string; evidence: Record<string, unknown>; occurredAt: string };
type Step = { key: string; label: string; done: boolean; at?: string };

function steps(action: ActionView, events: readonly ActionEvent[]): Step[] {
  const at = (type: string) => events.find((event) => event.type === type)?.occurredAt;
  const confirmed = action.status === "confirmed";
  const sent = Boolean(action.transactionHash) || ["submitted", "settling", "confirmed"].includes(action.status);
  const source = networkName(action.chainId);
  if (action.destinationChainId) {
    // Another network: sent, final on the source network, delivered by the bridge, then checked there.
    return [
      { key: "sent", label: `Sent from ${source}`, done: sent, at: at("submitted") },
      { key: "source_final", label: `Confirmed on ${source}`, done: confirmed || Boolean(at("source_final")), at: at("source_final") },
      { key: "delivered", label: `Delivered on ${networkName(action.destinationChainId)}`, done: confirmed || Boolean(at("delivered")), at: at("delivered") },
      { key: "confirmed", label: "Complete", done: confirmed, at: at("confirmed") }
    ];
  }
  return [
    { key: "sent", label: `Sent on ${source}`, done: sent, at: at("submitted") },
    { key: "settling", label: `Complete on ${source}`, done: confirmed || action.status === "settling", at: at("settling") },
    { key: "confirmed", label: `Final on ${source}`, done: confirmed, at: at("confirmed") }
  ];
}

/**
 * Where an action is, step by step, from Aura's chain-verified record. Only the
 * current step shows it's in progress; a failure shows on the step it stopped at.
 */
export function ActionJourney({ action, events }: { action: ActionView; events: readonly ActionEvent[] }) {
  const list = steps(action, events);
  const failed = action.status === "failed" || action.status === "expired";
  const pending = action.status === "submitted" || action.status === "settling";
  const current = list.findIndex((step) => !step.done);
  return <ol className="actionJourney" aria-label="Progress">
    {list.map((step, index) => {
      const state = step.done ? "done" : index === current ? (failed ? "failed" : pending ? "current" : "waiting") : "waiting";
      return <li key={step.key} className={state} aria-current={state === "current" ? "step" : undefined}>
        <i>{state === "done" ? <Check size={11} /> : state === "failed" ? <X size={11} /> : state === "current" ? <LoaderCircle className="spin" size={11} /> : null}</i>
        <span><strong>{step.label}</strong>
          <small>{state === "failed" ? (action.status === "expired" ? "Not confirmed in time." : failureText(action.failureReason))
            : step.at ? new Date(step.at).toLocaleString() : state === "current" ? "In progress" : ""}</small></span>
      </li>;
    })}
  </ol>;
}
