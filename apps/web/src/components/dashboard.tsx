"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { formatUnits } from "viem";
import { ApiError } from "@/lib/client/api";
import { useOverview } from "@/lib/client/queries";
import type { Holding, HoldingGroup, Overview } from "@/lib/overview/read";
import { MovePreviousAccount } from "./move-previous-account";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const groups: Array<{ key: HoldingGroup; title: string }> = [
  { key: "cash", title: "Cash" },
  { key: "crypto", title: "Crypto" },
  { key: "earn", title: "Earn" }
];
const sources: Record<string, string> = { base: "Base", "aave:base": "Aave on Base", "sky:ethereum": "Sky on Ethereum" };

function usdText(cents: number | null) {
  return cents === null ? "Unavailable" : usd.format(cents / 100);
}

function amountText(holding: Holding) {
  if (holding.amountRaw === null) return "Unavailable";
  const value = Number(formatUnits(BigInt(holding.amountRaw), holding.decimals));
  return `${value.toLocaleString("en-US", { maximumFractionDigits: value !== 0 && value < 1 ? 6 : 4 })} ${holding.symbol}`;
}

function timeText(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function HoldingRow({ holding, index }: { holding: Holding; index: number }) {
  return <div className="tableRow" data-testid={`holding-${holding.id}`}>
    <span className={`assetToken token${index % 3}`}>{holding.symbol.slice(0, 1)}</span>
    <span><strong>{holding.label}</strong><small>{holding.symbol}</small></span>
    <span>{sources[holding.source] ?? holding.source}</span>
    <span className="sensitiveAmount">{amountText(holding)}</span>
    <span className="sensitiveAmount"><strong>{holding.status === "unavailable" ? "Unavailable" : usdText(holding.usdCents)}</strong></span>
  </div>;
}

function Portfolio({ overview }: { overview: Overview }) {
  const empty = overview.holdings.every((item) => item.status === "observed" && item.amountRaw === "0");
  return <>
    <section className="panel widePanel portfolioTotal" aria-label="Total portfolio value">
      <p className="eyebrow">Total portfolio value</p>
      <strong className="sensitiveAmount" data-testid="portfolio-total">{usd.format(overview.totals.all.usdCents / 100)}</strong>
      <small>
        {overview.totals.all.partial ? "Some balances or prices are unavailable right now, so this total leaves them out. " : ""}
        Read from the chains at {timeText(overview.observedAt)}.
      </small>
    </section>
    {empty ? <section className="panel emptyState">
      <strong>Your account is empty</strong>
      <span>Add money to get started.</span>
      <Link className="button primary" href="/app/deposit">Deposit</Link>
    </section> : groups.map((group) => {
      const holdings = overview.holdings.filter((item) => item.group === group.key);
      if (holdings.length === 0) return null;
      const total = overview.totals[group.key];
      return <section className="panel widePanel" key={group.key} aria-label={group.title}>
        <div className="panelHeading"><h2>{group.title}</h2>
          <strong className="sensitiveAmount" data-testid={`total-${group.key}`}>{usd.format(total.usdCents / 100)}{total.partial ? " + unavailable" : ""}</strong></div>
        <div className="assetTable liveAssetTable">
          <div className="tableHead"><span>Asset</span><span>Where</span><span>Amount</span><span>Value</span></div>
          {holdings.map((holding, index) => <HoldingRow key={holding.id} holding={holding} index={index} />)}
        </div>
      </section>;
    })}
  </>;
}

/** The customer's balances on Base and their Earn deposits, each valued in US dollars, with one total. */
export function Dashboard() {
  const overview = useOverview();
  const { login, logout } = usePrivy();
  const expired = overview.error instanceof ApiError && overview.error.status === 401;
  return <div className="dashboardPage">
    <section className="pageIntro"><div><h1>Overview</h1><p>Your cash, crypto, and earn deposits in one place.</p></div>
      <div className="walletActions"><Link className="button secondary" href="/app/deposit">Deposit</Link><Link className="button primary" href="/app/send">Send</Link></div>
    </section>
    <MovePreviousAccount />
    {overview.isPending ? <div className="compactState" role="status"><LoaderCircle className="spin" size={17} /> Reading your balances</div>
      : expired ? <section className="panel formError" role="alert">Your session expired.{" "}
        <button type="button" className="textLink" onClick={() => void logout().then(() => login())}>Sign in again</button></section>
      : overview.error || !overview.data ? <section className="panel formError" role="alert">Your balances are unavailable right now.{" "}
        <button type="button" className="textLink" onClick={() => overview.refetch()}>Try again</button></section>
      : <Portfolio overview={overview.data} />}
    <div className="exampleNext"><Link className="button secondary" href="/app/transactions">View transactions</Link></div>
  </div>;
}
