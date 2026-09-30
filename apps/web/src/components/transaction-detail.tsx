"use client";

import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { actionEntry, entryAmount, entryLabel, statusLabel } from "@/lib/activity/entries";
import { networkName } from "@/lib/assets/registry";
import { explorerTx } from "@/lib/client/explorer";
import { useActionDetail } from "@/lib/client/queries";
import { formatCents, formatDateTime } from "@/lib/format";
import { ActionJourney } from "./action-journey";
import { LoadingState, Notice } from "./states";
import { entryTone, StatusDot } from "./status-dot";

const bankStateText: Record<string, string> = { awaiting_funds: "Waiting for your USDC", funds_received: "Bridge received your USDC",
  payment_submitted: "Sent to your bank", payment_processed: "Delivered to your bank", returned: "Returned by the bank", refunded: "Refunded" };

const Back = () => <Link className="appTextButton txBack" href="/app/transactions"><ArrowLeft aria-hidden="true" /> Back to transactions</Link>;

/** One action and its history (the receipt's "Full history"). Status comes from the chain; bank updates come from Bridge. */
export function TransactionDetail({ id }: { id: string }) {
  const query = useActionDetail(id);
  if (query.isPending) return <div className="mxPage txPage"><Back /><LoadingState label="Loading" /></div>;
  if (query.error || !query.data) return <div className="mxPage txPage"><Back /><Notice tone="error" role="alert">This transaction couldn&apos;t be loaded.</Notice></div>;
  const { action, events } = query.data;
  // The same description, amount, and status as the Transactions list.
  const entry = actionEntry(action);
  const bankUpdates = events.filter((event) => event.type === "bank_payout");
  const links = [{ name: "View on the network", url: explorerTx(action.chainId, action.transactionHash) },
    { name: "View delivery", url: explorerTx(action.destinationChainId, action.destinationTransactionHash) }].filter((link) => link.url);
  return <div className="mxPage txPage txDetail">
    <Back />
    <header className="txDetailHead"><h1>{entryLabel(entry.type)}{entryAmount(entry) ? ` ${entryAmount(entry)}` : ""}</h1>
      <StatusDot tone={entryTone(entry.status)} label={action.status === "prepared" ? "Waiting for you to confirm" : statusLabel(entry.status)} /></header>
    <section className="mxCard" aria-labelledby="detail-facts"><h2 id="detail-facts">Details</h2>
      <dl className="mxSummary">
        <div><dt>Network</dt><dd>{networkName(entry.chainId)}{entry.destinationChainId ? ` to ${networkName(entry.destinationChainId)}` : ""}</dd></div>
        {entry.counterparty && <div><dt>To</dt><dd className="mxBreak">{entry.counterparty}</dd></div>}
        {action.usdCents !== null && <div><dt>Value</dt><dd>{formatCents(action.usdCents)}</dd></div>}
        <div><dt>Reference</dt><dd className="mxBreak">{action.id}</dd></div>
      </dl>
    </section>
    <section className="mxCard" aria-labelledby="detail-progress"><h2 id="detail-progress">Progress</h2>
      <ActionJourney action={action} events={events} />
      {links.length > 0 && <div className="mxActions">{links.map((link) => <a className="appButton" key={link.name} href={link.url!} target="_blank" rel="noreferrer">{link.name} <ExternalLink aria-hidden="true" /></a>)}</div>}
    </section>
    {bankUpdates.length > 0 && <section className="mxCard" aria-labelledby="detail-bank"><h2 id="detail-bank">Bank updates</h2>
      <ol className="actionJourney">{bankUpdates.map((event, index) => <li key={`${event.type}-${index}`} className="done"><i />
        <span><strong>{bankStateText[String(event.evidence.state)] ?? "Bank update"}</strong><small>{formatDateTime(event.occurredAt)}</small></span></li>)}</ol>
    </section>}
  </div>;
}
