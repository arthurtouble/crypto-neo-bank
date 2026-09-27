"use client";

import { Check, CircleAlert, Clock3, ExternalLink, LoaderCircle, X } from "lucide-react";
import Link from "next/link";
import { SUPPORTED_CHAINS } from "@/config/chains";
import { networkName } from "@/lib/assets/registry";
import { failureText } from "@/lib/client/action-copy";
import { actionSettled, type ActionPhase, type ActionView } from "@/lib/client/use-action";

type Props = {
  /** What the customer is doing, in sentence case: "Transfer", "Swap", "Deposit". */
  label: string;
  phase: ActionPhase;
  action: ActionView | null;
  outcomeUnknown: boolean;
};

function explorerUrl(chainId: number | null, hash: string | null) {
  if (!chainId || !hash) return null;
  const base = SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}

function copy(label: string, phase: ActionPhase, action: ActionView | null) {
  if (phase === "preparing") return { step: 0, title: `Preparing ${label.toLowerCase()}`, detail: "Checking your limits and building the transaction." };
  if (phase === "signing") return { step: 1, title: "Confirm with your passkey", detail: "Review the request, then confirm it." };
  switch (action?.status) {
    case "settling": return action.destinationChainId
      ? { step: 3, title: `${label} sent`, detail: `It's waiting for the bridge to deliver it on ${networkName(action.destinationChainId)}, usually within 30 minutes. You can close this and track it in Transactions.` }
      : { step: 3, title: `${label} sent`, detail: "It becomes final on Base in about 15 minutes. You can close this and track it in Transactions." };
    case "confirmed": return { step: 3, title: `${label} complete`, detail: "The network confirmed it." };
    case "failed": return { step: 3, title: `${label} failed`, detail: failureText(action.failureReason) };
    case "expired": return { step: 3, title: `${label} not confirmed`, detail: "We didn't receive it in time. If you confirmed it in your wallet, check Transactions." };
    default: return { step: 2, title: `${label} submitted`, detail: "We're waiting for the network. You can leave this screen." };
  }
}

/**
 * Progress for one action from `useAction`, shown where the customer started
 * it. Errors and outcomes also appear as toasts. Only an outcome the customer
 * must check stays here after the action ends.
 */
export function TransactionProgress({ label, phase, action, outcomeUnknown }: Props) {
  if (phase === "idle") {
    if (!outcomeUnknown) return null;
    return <div className="transactionProgress failed" role="alert">
      <div className="transactionProgressHeadline">
        <span><X size={17} /></span>
        <div><strong>Check Transactions first</strong>
          <small>Your wallet may have sent this. Check Transactions before you try again.</small></div>
      </div>
      <div className="transactionLinks"><Link href="/app/transactions">Open Transactions</Link></div>
    </div>;
  }
  const { step, title, detail } = copy(label, phase, action);
  const failed = action?.status === "failed" || action?.status === "expired";
  const complete = action !== null && !failed && actionSettled(action);
  // Sent and handed off: nothing for the customer to wait for here.
  const sent = action?.status === "settling";
  const links = [
    ...(sent || complete ? [{ name: "Track in Transactions", url: `/app/transactions?open=${encodeURIComponent(action!.id)}`, internal: true }] : []),
    { name: "View transaction", url: explorerUrl(action?.chainId ?? null, action?.transactionHash ?? null) },
    { name: "View delivery", url: explorerUrl(action?.destinationChainId ?? null, action?.destinationTransactionHash ?? null) }
  ].filter((link): link is { name: string; url: string; internal?: boolean } => Boolean(link.url));
  return <div className={`transactionProgress ${failed ? "failed" : complete || sent ? "complete" : "active"}`} role={failed ? "alert" : "status"} aria-live="polite">
    <div className="transactionProgressHeadline">
      <span>{failed ? <X size={17} /> : complete ? <Check size={17} /> : sent ? <Clock3 size={17} /> : <LoaderCircle className="spin" size={17} />}</span>
      <div><strong>{title}</strong><small>{detail}</small></div>
    </div>
    {!failed && <div className="transactionSteps" aria-label={`${label} progress`}>
      {["Prepare", "Confirm", "Submitted", "Complete"].map((name, index) => <span className={index <= step ? "done" : ""} key={name}><i>{index < step || complete ? <Check size={10} /> : index + 1}</i>{name}</span>)}
    </div>}
    {failed && <div className="transactionFailureHint"><CircleAlert size={14} /> Nothing was retried automatically.</div>}
    {links.length > 0 && <div className="transactionLinks">{links.map((link) => link.internal ? <Link href={link.url} key={link.name}>{link.name}</Link>
      : <a href={link.url} target="_blank" rel="noreferrer" key={link.name}>{link.name}<ExternalLink size={12} /></a>)}</div>}
  </div>;
}
