"use client";

import { ExternalLink, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { actionEntry, entryAmount, entryLabel, statusLabel } from "@/lib/activity/entries";
import { networkName } from "@/lib/assets/registry";
import { explorerTx } from "@/lib/client/explorer";
import { useActionDetail } from "@/lib/client/queries";
import { ActionJourney } from "./action-journey";

const bankStateText: Record<string, string> = { awaiting_funds: "Waiting for your USDC", funds_received: "Bridge received your USDC",
  payment_submitted: "Sent to your bank", payment_processed: "Delivered to your bank", returned: "Returned by the bank", refunded: "Refunded" };

/** One action and its history. Status comes from the chain; bank updates come from Bridge. */
export function TransactionDetail({ id }: { id: string }) {
  const query = useActionDetail(id);
  if (query.isPending) return <section className="panel"><LoaderCircle className="spin" size={18} /> Loading</section>;
  if (query.error || !query.data) return <section className="panel"><p role="alert">This transaction couldn&apos;t be loaded.</p><Link href="/app/transactions">Back to transactions</Link></section>;
  const { action, events } = query.data;
  // The same description, amount, and status as the Transactions list.
  const entry = actionEntry(action);
  const bankUpdates = events.filter((event) => event.type === "bank_payout");
  const links = [{ name: "View on the network", url: explorerTx(action.chainId, action.transactionHash) },
    { name: "View delivery", url: explorerTx(action.destinationChainId, action.destinationTransactionHash) }].filter((link) => link.url);
  return <div>
    <section className="pageIntro compact"><div><h1>{entryLabel(entry.type)}{entryAmount(entry) ? ` ${entryAmount(entry)}` : ""}</h1>
      <p>{action.status === "prepared" ? "Waiting for you to confirm" : statusLabel(entry.status)}</p></div></section>
    <section className="panel">
      <div className="receiptDetails">
        <span>Network<strong>{networkName(entry.chainId)}{entry.destinationChainId ? ` to ${networkName(entry.destinationChainId)}` : ""}</strong></span>
        {entry.counterparty && <span>To<strong>{entry.counterparty}</strong></span>}
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
