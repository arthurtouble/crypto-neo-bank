"use client";

import { ExternalLink, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { SUPPORTED_CHAINS } from "@/config/chains";
import { useActionDetail } from "@/lib/client/queries";
import { ActionJourney } from "./action-journey";

const statusText: Record<string, string> = { prepared: "Waiting for you to confirm", submitted: "Waiting for the network", settling: "On its way",
  confirmed: "Complete", failed: "Failed", expired: "Not confirmed" };
const bankStateText: Record<string, string> = { awaiting_funds: "Waiting for your USDC", funds_received: "Bridge received your USDC",
  payment_submitted: "Sent to your bank", payment_processed: "Delivered to your bank", returned: "Returned by the bank", refunded: "Refunded" };

function explorer(chainId: number | null, hash: string | null) {
  const url = SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.blockExplorers?.default.url;
  return url && hash ? `${url}/tx/${hash}` : null;
}

/** One action and its history. Status comes from the chain; bank updates come from Bridge. */
export function TransactionDetail({ id }: { id: string }) {
  const query = useActionDetail(id);
  if (query.isPending) return <section className="panel"><LoaderCircle className="spin" size={18} /> Loading</section>;
  if (query.error || !query.data) return <section className="panel"><p role="alert">This transaction couldn&apos;t be loaded.</p><Link href="/app/transactions">Back to transactions</Link></section>;
  const { action, events } = query.data;
  const summary = action.summary as Record<string, unknown>;
  const bankUpdates = events.filter((event) => event.type === "bank_payout");
  const links = [{ name: "View on the network", url: explorer(action.chainId, action.transactionHash) },
    { name: "View delivery", url: explorer(action.destinationChainId, action.destinationTransactionHash) }].filter((link) => link.url);
  return <div>
    <section className="pageIntro compact"><div><h1>{typeof summary.amount === "string" ? `${summary.amount} ${String(summary.symbol ?? "")}` : "Transaction"}</h1>
      <p>{statusText[action.status] ?? action.status}</p></div></section>
    <section className="panel">
      <div className="receiptDetails">
        <span>Type<strong>{action.kind === "route" ? "Swap or move" : action.kind === "earn" ? "Earn" : "Send"}</strong></span>
        {typeof (summary.to ?? summary.recipient) === "string" && <span>To<strong>{String(summary.to ?? summary.recipient)}</strong></span>}
        {action.usdCents !== null && <span>Value<strong>${(action.usdCents / 100).toFixed(2)}</strong></span>}
        <span>Reference<strong>{action.id}</strong></span>
      </div>
      <ActionJourney action={action} events={events} />
      {bankUpdates.length > 0 && <div className="receiptTimeline"><h2>Bank updates</h2>{bankUpdates.map((event, index) => <div key={`${event.type}-${index}`}><i />
        <span><strong>{bankStateText[String(event.evidence.state)] ?? "Bank update"}</strong>
          <small>{new Date(event.occurredAt).toLocaleString()}</small></span></div>)}</div>}
      {links.map((link) => <a className="button secondary" key={link.name} href={link.url!} target="_blank" rel="noreferrer">{link.name} <ExternalLink size={14} /></a>)}
      <p><Link href="/app/transactions">Back to transactions</Link></p>
    </section>
  </div>;
}
