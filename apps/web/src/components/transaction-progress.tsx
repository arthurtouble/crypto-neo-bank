"use client";

import { Check, CircleAlert, ExternalLink, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import { SUPPORTED_CHAINS } from "@/config/chains";
import type { ActionPhase, ActionView } from "@/lib/client/use-action";

type Props = {
  /** What the customer is doing, in sentence case: "Transfer", "Swap", "Deposit". */
  label: string;
  phase: ActionPhase;
  action: ActionView | null;
  error: string | null;
  outcomeUnknown: boolean;
};

function explorerUrl(chainId: number | null, hash: string | null) {
  if (!chainId || !hash) return null;
  const base = SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}

/** Customer wording for a verifier reason. Unknown reasons fall back to a generic line rather than a code. */
function failureText(reason: string | null): string {
  if (!reason) return "It didn't complete. Check the reason before trying again.";
  if (reason === "refunded") return "The transfer was refunded to your wallet on the original network.";
  if (reason === "partial_delivery") return "It arrived as a different asset. Check your wallet.";
  if (reason === "delivery_below_minimum") return "Less than the minimum arrived. Contact Support.";
  if (reason === "delivery_failed" || reason.startsWith("destination_")) return "Delivery failed. Contact Support before trying again.";
  if (reason === "operation_reverted" || reason === "transaction_reverted") return "The network rejected it. Nothing moved.";
  return "We couldn't match this transaction to what you confirmed. Contact Support.";
}

function copy(label: string, phase: ActionPhase, action: ActionView | null) {
  if (phase === "preparing") return { step: 0, title: `Preparing ${label.toLowerCase()}`, detail: "Checking your limits and building the transaction." };
  if (phase === "signing") return { step: 1, title: "Confirm in your wallet", detail: "Review the request, then confirm it." };
  switch (action?.status) {
    case "settling": return { step: 2, title: "On its way", detail: "The first transaction is confirmed. We're waiting for delivery." };
    case "confirmed": return { step: 3, title: `${label} complete`, detail: "The network confirmed it." };
    case "failed": return { step: 3, title: `${label} failed`, detail: failureText(action.failureReason) };
    case "expired": return { step: 3, title: `${label} not confirmed`, detail: "We didn't receive it in time. If you confirmed it in your wallet, check Transactions." };
    default: return { step: 2, title: `${label} submitted`, detail: "We're waiting for the network. You can leave this screen." };
  }
}

/** Progress for one action from `useAction`. Renders nothing while idle without an error. */
export function TransactionProgress({ label, phase, action, error, outcomeUnknown }: Props) {
  if (phase === "idle") {
    if (!error) return null;
    return <div className="transactionProgress failed" role="alert">
      <div className="transactionProgressHeadline">
        <span><X size={17} /></span>
        <div><strong>{outcomeUnknown ? "Check Transactions first" : `${label} not sent`}</strong>
          <small>{outcomeUnknown ? "Your wallet may have sent this. Check Transactions before you try again." : error}</small></div>
      </div>
      {outcomeUnknown && <div className="transactionLinks"><Link href="/app/transactions">Open Transactions</Link></div>}
    </div>;
  }
  const { step, title, detail } = copy(label, phase, action);
  const failed = action?.status === "failed" || action?.status === "expired";
  const complete = action?.status === "confirmed";
  const links = [
    { name: "View transaction", url: explorerUrl(action?.chainId ?? null, action?.transactionHash ?? null) },
    { name: "View delivery", url: explorerUrl(action?.destinationChainId ?? null, action?.destinationTransactionHash ?? null) }
  ].filter((link): link is { name: string; url: string } => Boolean(link.url));
  return <div className={`transactionProgress ${failed ? "failed" : complete ? "complete" : "active"}`} role={failed ? "alert" : "status"} aria-live="polite">
    <div className="transactionProgressHeadline">
      <span>{failed ? <X size={17} /> : complete ? <Check size={17} /> : <LoaderCircle className="spin" size={17} />}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
    </div>
    {!failed && <div className="transactionSteps" aria-label={`${label} progress`}>
      {["Prepare", "Confirm", "Submitted", "Complete"].map((name, index) => <span className={index <= step ? "done" : ""} key={name}><i>{index < step || complete ? <Check size={10} /> : index + 1}</i>{name}</span>)}
    </div>}
    {failed && <div className="transactionFailureHint"><CircleAlert size={14} /> Nothing was retried automatically.</div>}
    {links.length > 0 && <div className="transactionLinks">{links.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={link.name}>{link.name}<ExternalLink size={12} /></a>)}</div>}
  </div>;
}
