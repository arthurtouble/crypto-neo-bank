"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowDownUp, ArrowLeft, ArrowUpFromLine, Building2, CreditCard, QrCode, TrendingUp, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { entryAmount, entryLabel, statusLabel, type ActivityEntry } from "@/lib/activity/entries";
import type { History } from "@/lib/activity/history";
import { registeredAsset } from "@/lib/assets/registry";
import { ApiError, useApi } from "@/lib/client/api";
import { useOverview } from "@/lib/client/queries";
import { exampleActivity } from "@/lib/example/data";
import { formatCents, formatShortDateTime, formatTime, formatToken, formatWeekdayTime, fromRaw } from "@/lib/format";
import type { Holding, HoldingGroup, Overview } from "@/lib/overview/read";
import { GuestBanner } from "./guest-banner";
import { LiveAmount, positionUsd } from "./live-amount";
import { MovePreviousAccount } from "./move-previous-account";
import { Sheet } from "./sheet";
import { entryTone, StatusDot } from "./status-dot";

const groups: Array<{ key: HoldingGroup; title: string }> = [
  { key: "cash", title: "Cash" },
  { key: "crypto", title: "Crypto" },
  { key: "stocks", title: "Stocks" },
  { key: "metals", title: "Metals" },
  { key: "earn", title: "Earn" }
];
const sources: Record<string, string> = { base: "Base", ethereum: "Ethereum", "aave:base": "Aave on Base", "morpho:base": "Morpho on Base", example: "Example" };

function usdText(cents: number | null) {
  return cents === null ? "Unavailable" : formatCents(cents);
}

function amountText(holding: Holding) {
  if (holding.amountRaw === null) return "Unavailable";
  return formatToken(fromRaw(holding.amountRaw, holding.decimals), holding.symbol);
}

const timeText = formatTime;

/** Stock, gold, and euro prices pause outside market hours; say when the one used was published. */
const priceTime = formatWeekdayTime;

/** A dollar amount with the cents set smaller, for the total. */
function Dollars({ cents }: { cents: number }) {
  const [whole, fraction] = formatCents(cents).split(".");
  return <>{whole}<span className="ovCents">.{fraction}</span></>;
}

function Token({ symbol }: { symbol: string }) {
  return <span className="appIconDisc ovToken" aria-hidden="true">{symbol.slice(0, 4)}</span>;
}

function HoldingValue({ holding }: { holding: Holding }) {
  const live = holding.group === "earn" ? positionUsd(holding) : null;
  return <span className="ovValue sensitiveAmount">
    <strong className={holding.status === "unavailable" || holding.usdCents === null ? "appUnavailable" : undefined}>
      {holding.status === "unavailable" ? "Unavailable" : live !== null ? <LiveAmount usd={live} apyPct={holding.apyPct} observedAt={holding.observedAt} /> : usdText(holding.usdCents)}</strong>
    {holding.group === "earn" && holding.apyPct !== undefined && holding.usdCents ? <small>Earning {holding.apyPct.toFixed(2)}% a year</small> : null}
    {holding.priceObservedAt && holding.usdCents !== null && <small>Price as of {priceTime(holding.priceObservedAt)}</small>}
  </span>;
}

function HoldingRow({ holding, onOpen }: { holding: Holding; onOpen: () => void }) {
  return <button type="button" className="ovRow" data-testid={`holding-${holding.id}`} onClick={onOpen}>
    <span className="ovAsset"><Token symbol={holding.symbol} /><span><strong>{holding.label}</strong><small>{holding.symbol} · {sources[holding.source] ?? holding.source}</small></span></span>
    <span className="ovAmount sensitiveAmount">{amountText(holding)}</span>
    <HoldingValue holding={holding} />
  </button>;
}

/** A holding's detail, with what can be done with it: a side panel on desktop, a pushed screen on the phone. */
function HoldingDetail({ holding, isExample, onSignIn, onClose }: { holding: Holding; isExample: boolean; onSignIn: () => void; onClose: () => void }) {
  const asset = registeredAsset(holding.id);
  const actions: Array<{ label: string; href: string; primary?: boolean }> = holding.group === "earn"
    ? [{ label: "Open Earn", href: "/app/earn", primary: true }]
    : [
      ...(asset?.uses.includes("send") ? [{ label: "Send", href: `/app/send?asset=${encodeURIComponent(asset.symbol)}`, primary: true }] : []),
      ...(asset?.uses.includes("swap") ? [{ label: "Swap", href: `/app/swap?from=${encodeURIComponent(asset.id)}` }] : []),
      ...(asset?.uses.includes("deposit") ? [{ label: "Deposit", href: "/app/deposit" }] : [])
    ];
  const facts: Array<[string, React.ReactNode]> = [
    ["Amount", <span className="sensitiveAmount" key="amount">{amountText(holding)}</span>],
    ["Value", <HoldingValue holding={holding} key="value" />],
    ["Where", sources[holding.source] ?? holding.source],
    ["Read at", timeText(holding.observedAt)]
  ];
  return <Sheet variant="panel" onOpenChange={(open) => { if (!open) onClose(); }}>
        <div className="ovPanelHead">
          <Dialog.Close className="appIconButton ovPanelBack" aria-label="Back"><ArrowLeft aria-hidden="true" /></Dialog.Close>
          <Token symbol={holding.symbol} />
          <Dialog.Title>{holding.label}</Dialog.Title>
          <Dialog.Close className="appIconButton ovPanelClose" aria-label="Close"><X aria-hidden="true" /></Dialog.Close>
        </div>
        <dl className="ovFacts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {asset?.note && <p className="ovNote">{asset.note}</p>}
        {actions.length > 0 && <div className="ovPanelActions">{actions.map((action) => isExample
          ? <button key={action.label} type="button" className={`appButton appButtonLarge${action.primary ? " appButtonPrimary" : ""}`} onClick={onSignIn}>{action.label}</button>
          : <Link key={action.label} href={action.href} className={`appButton appButtonLarge${action.primary ? " appButtonPrimary" : ""}`}>{action.label}</Link>)}</div>}
  </Sheet>;
}

const depositWays = [
  { icon: QrCode, title: "Receive", detail: "From an exchange or another wallet" },
  { icon: Wallet, title: "From a wallet", detail: "Connect a wallet you already use" },
  { icon: CreditCard, title: "Card", detail: "Buy with a debit or credit card" },
  { icon: Building2, title: "Bank", detail: "A US bank transfer, once you're verified" }
];

function Holdings({ overview, isExample, onSignIn }: { overview: Overview; isExample: boolean; onSignIn: () => void }) {
  const [filter, setFilter] = useState<HoldingGroup | "all">("all");
  const [open, setOpen] = useState<Holding | null>(null);
  const present = groups.filter((group) => overview.holdings.some((item) => item.group === group.key));
  const empty = overview.holdings.every((item) => item.status === "observed" && item.amountRaw === "0");
  if (empty) return <section className="ovCard ovEmpty" aria-label="Your account is empty">
    <div><h2>Your account is empty</h2><p>Add money to get started.</p></div>
    <ul className="ovWays">{depositWays.map(({ icon: Icon, title, detail }) => <li key={title}><span className="ovWayIcon"><Icon aria-hidden="true" /></span><span><strong>{title}</strong><small>{detail}</small></span></li>)}</ul>
    <Link className="appButton appButtonPrimary" href="/app/deposit">Deposit</Link>
  </section>;
  const shown = filter === "all" ? present : present.filter((group) => group.key === filter);
  return <>
    <div className="ovChips" role="group" aria-label="Show">
      <button type="button" className="ovChip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
      {present.map((group) => {
        const total = overview.totals[group.key];
        return <button type="button" className="ovChip" key={group.key} aria-pressed={filter === group.key} onClick={() => setFilter(group.key)}>
          {group.title} <strong className={`sensitiveAmount${total.partial && total.usdCents === 0 ? " appUnavailable" : ""}`} data-testid={isExample ? undefined : `total-${group.key}`}>
            {formatCents(total.usdCents)}{total.partial ? " + unavailable" : ""}</strong></button>;
      })}
    </div>
    <div className="ovCard ovTable">
      <div className="ovTableHead" aria-hidden="true"><span>Asset</span><span>Amount</span><span>Value</span></div>
      {shown.map((group) => <section key={group.key} aria-label={group.title} className="ovGroup">
        {filter === "all" && <h3 className="ovGroupTitle">{group.title}</h3>}
        {overview.holdings.filter((item) => item.group === group.key).map((holding) => <HoldingRow key={holding.id} holding={holding} onOpen={() => setOpen(holding)} />)}
      </section>)}
    </div>
    {open && <HoldingDetail holding={overview.holdings.find((item) => item.id === open.id) ?? open} isExample={isExample} onSignIn={onSignIn} onClose={() => setOpen(null)} />}
  </>;
}

/** Desktop only: the latest transactions beside the holdings. */
function Recent({ isExample }: { isExample: boolean }) {
  const { user } = useAuth();
  const api = useApi();
  const query = useQuery({ queryKey: ["activity", user?.id], queryFn: () => api<History>("/api/activity"), enabled: Boolean(user) && !isExample, refetchInterval: 30_000 });
  const entries = isExample ? exampleActivity : query.data?.entries.slice(0, 5);
  return <section className="ovCard ovRecent" aria-label="Recent transactions">
    <div className="ovCardHead"><h2>Recent</h2><Link className="appTextButton" href="/app/transactions">View all</Link></div>
    {!isExample && query.isPending ? <div className="ovRecentList" role="status" aria-label="Loading transactions">{[0, 1, 2].map((key) => <div className="ovSkelRow" key={key}><span className="ovSkel" /><span className="ovSkel" /></div>)}</div>
      : !isExample && query.isError ? <p className="ovRecentNote">Transactions can&apos;t be read right now.</p>
        : !entries?.length ? <p className="ovRecentNote">No transactions yet. Money you send, receive, swap, or earn shows up here.</p>
          : <ul className="ovRecentList">{entries.map((entry) => <RecentRow key={entry.id} entry={entry} isExample={isExample} />)}</ul>}
  </section>;
}

function RecentRow({ entry, isExample }: { entry: ActivityEntry; isExample: boolean }) {
  const incoming = entry.type === "received" || entry.type === "bank_deposit" || entry.type === "card_refund";
  const Icon = incoming ? ArrowDownToLine : entry.type === "swap" || entry.type === "bridge" ? ArrowDownUp : entry.type.startsWith("earn") ? TrendingUp : ArrowUpFromLine;
  const amount = entryAmount(entry);
  const body = <>
    <span className="appIconDisc"><Icon aria-hidden="true" /></span>
    <span className="ovRecentWhat"><strong>{entryLabel(entry.type)}</strong><small>{formatShortDateTime(entry.createdAt)}</small></span>
    <span className="ovRecentAmount"><strong className={`sensitiveAmount${incoming && entry.status === "completed" ? " ovIn" : ""}`}>{amount ? `${incoming ? "+" : ""}${amount}` : "—"}</strong>
      <StatusDot tone={entryTone(entry.status)} label={statusLabel(entry.status)} /></span>
  </>;
  return <li>{isExample ? <div className="ovRecentRow">{body}</div> : <Link className="ovRecentRow" href={`/app/transactions?open=${encodeURIComponent(entry.id)}`}>{body}</Link>}</li>;
}

function Loading() {
  return <div className="ovLoading" role="status" aria-label="Reading your balances">
    <div className="ovTotal"><span className="ovSkel" style={{ width: 120 }} /><span className="ovSkel ovSkelBig" /><span className="ovSkel" style={{ width: 220 }} /></div>
    <div className="ovCard ovTable">{[0, 1, 2, 3].map((key) => <div className="ovSkelRow" key={key}><span className="ovSkel" /><span className="ovSkel" /></div>)}</div>
  </div>;
}

/** The customer's balances on Base and their Earn deposits, each valued in US dollars, with one total. Guests see labelled example data. */
export function Dashboard() {
  const overview = useOverview();
  const { login, logout, ready } = useAuth();
  const expired = overview.error instanceof ApiError && overview.error.status === 401;
  const isExample = overview.isExample;
  const data = overview.data;
  return <div className="ovPage">
    {isExample && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="ovHead">
      <h1>Overview</h1>
      <div className="ovHeadActions">
        <Link className="appButton" href="/app/deposit"><ArrowDownToLine aria-hidden="true" />Deposit</Link>
        <Link className="appButton" href="/app/swap"><ArrowDownUp aria-hidden="true" />Swap</Link>
        <Link className="appButton appButtonPrimary" href="/app/send"><ArrowUpFromLine aria-hidden="true" />Send</Link>
      </div>
    </header>
    {!isExample && <MovePreviousAccount />}
    {overview.isPending ? <Loading />
      : expired ? <div className="ovNotice ovNoticeError" role="alert"><span>Your session expired.</span>
        <button type="button" className="appTextButton" onClick={() => void logout().then(() => login())}>Sign in again</button></div>
        : overview.error || !data ? <div className="ovNotice ovNoticeError" role="alert"><span>Your balances are unavailable right now.</span>
          <button type="button" className="appTextButton" onClick={() => overview.refetch()}>Try again</button></div>
          : <>
            <section className="ovTotal" aria-label="Total value">
              <span className="ovLabel">Total value</span>
              <strong className="ovTotalValue sensitiveAmount" data-testid={isExample ? undefined : "portfolio-total"}><Dollars cents={data.totals.all.usdCents} /></strong>
              <small>
                {isExample ? "Example values. " : `Read from the chains at ${timeText(data.observedAt)}. `}
                {data.totals.all.partial ? <span className="ovPartial">Some balances or prices are unavailable right now, so this total leaves them out.</span> : null}
              </small>
            </section>
            <nav className="ovQuick" aria-label="Quick actions">
              {[{ href: "/app/deposit", label: "Deposit", icon: ArrowDownToLine }, { href: "/app/send", label: "Send", icon: ArrowUpFromLine },
                { href: "/app/swap", label: "Swap", icon: ArrowDownUp }, { href: "/app/earn", label: "Earn", icon: TrendingUp }].map(({ href, label, icon: Icon }) =>
                <Link key={label} href={href}><span><Icon aria-hidden="true" /></span>{label}</Link>)}
            </nav>
            <div className="ovColumns">
              <div className="ovMainColumn"><Holdings overview={data} isExample={isExample} onSignIn={login} /></div>
              <aside className="ovSideColumn"><Recent isExample={isExample} /></aside>
            </div>
          </>}
  </div>;
}
