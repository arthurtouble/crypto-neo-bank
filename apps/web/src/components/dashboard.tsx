"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowDownUp, ArrowLeft, ArrowUpFromLine, Building2, ChevronRight, CreditCard, QrCode, TrendingUp, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { entryAmount, entryLabel, statusLabel, type ActivityEntry } from "@/lib/activity/entries";
import type { History } from "@/lib/activity/history";
import { registeredAsset } from "@/lib/assets/registry";
import { ApiError, useApi } from "@/lib/client/api";
import { useOverview } from "@/lib/client/queries";
import { useBankAccount } from "@/lib/client/use-bank-account";
import { ADD_MONEY_WAYS, addMoneyHref, type AddMoneyWay } from "@/lib/deposits/ways";
import { exampleActivity } from "@/lib/example/data";
import { formatCents, formatShortDateTime, formatTime, formatToken, formatWeekdayTime, fromRaw } from "@/lib/format";
import { holdingActions } from "@/lib/overview/actions";
import type { Holding, HoldingGroup, Overview } from "@/lib/overview/read";
import { GuestBanner } from "./guest-banner";
import { Sheet } from "./sheet";
import { entryTone, StatusDot } from "./status-dot";

const groups: Array<{ key: HoldingGroup; title: string }> = [
  { key: "cash", title: "Cash" },
  { key: "crypto", title: "Crypto" },
  { key: "stocks", title: "Stocks" },
  { key: "metals", title: "Metals" },
  { key: "earn", title: "Earn" }
];
const sources: Record<string, string> = { base: "Base", ethereum: "Ethereum", "aave:base": "Aave", "morpho:base": "Morpho", example: "Example" };

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

/** The ticker in a disc: tokenized stocks drop their trailing "c" (AAPLc shows AAPL), so five letters fit. */
function Token({ holding }: { holding: Pick<Holding, "symbol" | "group"> }) {
  const ticker = holding.group === "stocks" ? holding.symbol.replace(/c$/, "") : holding.symbol;
  return <span className="appIconDisc ovToken" aria-hidden="true">{ticker.slice(0, 5)}</span>;
}

function HoldingValue({ holding }: { holding: Holding }) {
  return <span className="ovValue sensitiveAmount">
    <strong className={holding.status === "unavailable" || holding.usdCents === null ? "appUnavailable" : undefined}>
      {holding.status === "unavailable" ? "Unavailable" : usdText(holding.usdCents)}</strong>
    {holding.group === "earn" && holding.apyPct !== undefined && holding.usdCents ? <small>Earning {holding.apyPct.toFixed(2)}% a year</small> : null}
    {holding.priceObservedAt && holding.usdCents !== null && <small>Price as of {priceTime(holding.priceObservedAt)}</small>}
  </span>;
}

function HoldingRow({ holding, onOpen }: { holding: Holding; onOpen: () => void }) {
  return <button type="button" className="ovRow" data-testid={`holding-${holding.id}`} onClick={onOpen}>
    <span className="ovAsset"><Token holding={holding} /><span><strong>{holding.label}</strong><small>{holding.symbol}</small></span></span>
    <span className="ovAmount sensitiveAmount">{amountText(holding)}</span>
    <HoldingValue holding={holding} />
  </button>;
}

/** A holding's detail, with what can be done with it: a side panel on desktop, a pushed screen on the phone. */
function HoldingDetail({ holding, isExample, onSignIn, onClose }: { holding: Holding; isExample: boolean; onSignIn: () => void; onClose: () => void }) {
  const asset = registeredAsset(holding.id);
  const actions = holdingActions(holding);
  const facts: Array<[string, React.ReactNode]> = [
    ["Amount", <span className="sensitiveAmount" key="amount">{amountText(holding)}</span>],
    ["Value", <HoldingValue holding={holding} key="value" />],
    ["Where", sources[holding.source] ?? holding.source],
    ["Updated", timeText(holding.observedAt)]
  ];
  return <Sheet variant="panel" onOpenChange={(open) => { if (!open) onClose(); }}>
        <div className="ovPanelHead">
          <Dialog.Close className="appIconButton ovPanelBack" aria-label="Back"><ArrowLeft aria-hidden="true" /></Dialog.Close>
          <Token holding={holding} />
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

const wayIcons = { receive: QrCode, wallet: Wallet, card: CreditCard, bank: Building2 } satisfies Record<AddMoneyWay, unknown>;

/** Every balance read, and every one is zero: nothing to send, swap, or earn with yet. */
function isEmpty(overview: Overview) {
  return overview.holdings.every((item) => item.status === "observed" && item.amountRaw === "0");
}

/** The ways to add money, each opening its tab on Add money. A way that can't be used yet says so before it's tapped. */
function EmptyAccount() {
  const api = useApi();
  const { user } = useAuth();
  const bank = useBankAccount();
  // The same query, and so the same answer, as the card tab on Add money.
  const card = useQuery({ queryKey: ["deposit-methods"], queryFn: () => api<{ card: boolean }>("/api/deposits/methods"), enabled: Boolean(user) });
  const unavailable: Partial<Record<AddMoneyWay, string>> = {
    ...(card.data && !card.data.card ? { card: "Not available right now" } : {}),
    ...(bank.data && !bank.data.available ? { bank: "Coming soon" } : {})
  };
  return <section className="ovCard ovEmpty" aria-labelledby="overview-empty">
    <div><h2 id="overview-empty">Your account is empty</h2><p>Choose how to add money.</p></div>
    <ul className="ovWays">{ADD_MONEY_WAYS.map(({ id, label, detail }) => {
      const Icon = wayIcons[id];
      return <li key={id}><Link className="ovWay" href={addMoneyHref(id)}>
      <span className="ovWayIcon"><Icon aria-hidden="true" /></span>
      <span className="ovWayText"><strong>{label}</strong><small>{detail}</small>
        {unavailable[id] && <span className="ovWayBadge">{unavailable[id]}</span>}</span>
      <ChevronRight className="ovWayChevron" aria-hidden="true" /></Link></li>;
    })}</ul>
  </section>;
}

function Holdings({ overview, isExample, onSignIn }: { overview: Overview; isExample: boolean; onSignIn: () => void }) {
  const [filter, setFilter] = useState<HoldingGroup | "all">("all");
  const [open, setOpen] = useState<Holding | null>(null);
  const present = groups.filter((group) => overview.holdings.some((item) => item.group === group.key));
  if (isEmpty(overview)) return <EmptyAccount />;
  const shown = filter === "all" ? present : present.filter((group) => group.key === filter);
  return <>
    <div className="ovChips" role="group" aria-label="Show">
      <button type="button" className="ovChip" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
      {present.map((group) => {
        const total = overview.totals[group.key];
        // A group with nothing read says so, rather than $0.00.
        const unread = overview.holdings.filter((item) => item.group === group.key).every((item) => item.usdCents === null);
        return <button type="button" className="ovChip" key={group.key} aria-pressed={filter === group.key} onClick={() => setFilter(group.key)}>
          {group.title} <strong className={`sensitiveAmount${unread ? " appUnavailable" : ""}`} data-testid={isExample ? undefined : `total-${group.key}`}>
            {unread ? "Unavailable" : `${formatCents(total.usdCents)}${total.partial ? " + unavailable" : ""}`}</strong></button>;
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

/** The latest transactions: five beside the holdings on desktop, three below them on the phone. */
function Recent({ isExample }: { isExample: boolean }) {
  const { user } = useAuth();
  const api = useApi();
  const query = useQuery({ queryKey: ["activity", user?.id], queryFn: () => api<History>("/api/activity"), enabled: Boolean(user) && !isExample, refetchInterval: 30_000 });
  const entries = isExample ? exampleActivity : query.data?.entries.slice(0, 5);
  return <section className="ovCard ovRecent" aria-label="Recent transactions">
    <div className="ovCardHead"><h2>Recent</h2><Link className="appTextButton" href="/app/transactions">View all</Link></div>
    {!isExample && query.isPending ? <div className="ovRecentList" role="status" aria-label="Loading transactions">{[0, 1, 2].map((key) => <div className="ovSkelRow" key={key}><span className="ovSkel" /><span className="ovSkel" /></div>)}</div>
      : !isExample && query.isError ? <div className="ovNotice ovNoticeError ovRecentError" role="alert"><span>Transactions can&apos;t be loaded right now.</span>
        <button type="button" className="appTextButton" onClick={() => void query.refetch()}>Try again</button></div>
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

/** The same four actions, in the same order, as buttons on desktop and round buttons on the phone. */
const quickActions = [
  { href: "/app/deposit", label: "Add money", icon: ArrowDownToLine },
  { href: "/app/send", label: "Send", icon: ArrowUpFromLine },
  { href: "/app/swap", label: "Swap", icon: ArrowDownUp },
  { href: "/app/earn", label: "Earn", icon: TrendingUp }
];

function Loading() {
  return <div className="ovLoading" role="status" aria-label="Reading your balances">
    <div className="ovTotal"><span className="ovSkel ovSkelLabel" /><span className="ovSkel ovSkelBig" /><span className="ovSkel ovSkelLine" /></div>
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
  // With nothing in the account, the one thing that works is adding money, so that's the main button.
  const primaryAction = data && !isExample && isEmpty(data) ? "Add money" : "Send";
  return <div className="ovPage">
    {isExample && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="ovHead">
      <h1>Overview</h1>
      <div className="ovHeadActions">
        {quickActions.map(({ href, label, icon: Icon }) => <Link key={label} className={`appButton${label === primaryAction ? " appButtonPrimary" : ""}`} href={href}><Icon aria-hidden="true" />{label}</Link>)}
      </div>
    </header>
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
                {isExample ? "Example values. " : `Updated ${timeText(data.observedAt)}. `}
                {data.totals.all.partial ? <span className="ovPartial">Some balances or prices are unavailable right now, so this total leaves them out.</span> : null}
              </small>
            </section>
            <nav className="ovQuick" aria-label="Quick actions">
              {quickActions.map(({ href, label, icon: Icon }) => <Link key={label} href={href}><span><Icon aria-hidden="true" /></span>{label}</Link>)}
            </nav>
            <div className="ovColumns">
              <div className="ovMainColumn"><Holdings overview={data} isExample={isExample} onSignIn={login} /></div>
              <aside className="ovSideColumn"><Recent isExample={isExample} /></aside>
            </div>
          </>}
  </div>;
}
