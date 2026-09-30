import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, short, when } from "./api";

type Row = { id: string; origin: "aura" | "incoming" | "card"; label: string; amountText: string | null; statusText: string; status: string; subject: string;
  createdAt: string; counterparty: string | null; transactionHash: string | null; chainId: number; source: string };
type Page = { rows: Row[]; next: string | null };
type Detail = {
  action: { id: string; subject: string; wallet: string; kind: string; chainId: number; status: string; summary: Record<string, unknown>; transactionHash: string | null;
    destinationChainId: number | null; destinationTransactionHash: string | null; failureReason: string | null; createdAt: string; submittedAt: string | null;
    settledAt: string | null; checkedAt: string | null; bankState: string | null; usdCents: number | null };
  entry: { label: string; amountText: string | null; statusText: string; counterparty?: string; bankStatus?: string };
  events: Array<{ type: string; evidence: Record<string, unknown>; occurredAt: string }>;
};

const explorers: Record<number, string> = { 1: "https://etherscan.io", 8453: "https://basescan.org", 10: "https://optimistic.etherscan.io", 137: "https://polygonscan.com", 42161: "https://arbiscan.io" };
const txLink = (chainId: number | null, hash: string | null | undefined) => chainId && hash && explorers[chainId] ? `${explorers[chainId]}/tx/${hash}` : null;

function Journey({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ["action", id], queryFn: () => api<Detail>(`actions/${encodeURIComponent(id)}`) });
  const check = useMutation({ mutationFn: () => api(`actions/${encodeURIComponent(id)}/check`, { method: "POST" }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["action", id] }); void client.invalidateQueries({ queryKey: ["actions"] }); } });
  const data = detail.data;
  const source = data && txLink(data.action.chainId, data.action.transactionHash);
  const delivery = data && txLink(data.action.destinationChainId, data.action.destinationTransactionHash);
  return <aside className="drawer" role="dialog" aria-modal="false" aria-labelledby="journey-heading">
    <header><h2 id="journey-heading">Action journey</h2><button type="button" className="button quiet" onClick={onClose}>Close</button></header>
    {detail.isError && <div className="notice error" role="alert">{detail.error.message}</div>}
    {data && <>
      <dl className="facts">
        <div><dt>What</dt><dd>{data.entry.label}{data.entry.amountText ? ` ${data.entry.amountText}` : ""}{data.entry.counterparty ? ` to ${data.entry.counterparty}` : ""}</dd></div>
        <div><dt>Status</dt><dd>{data.entry.statusText} ({data.action.status}){data.action.failureReason ? `: ${data.action.failureReason}` : ""}</dd></div>
        {data.entry.bankStatus && <div><dt>Bank</dt><dd>{data.entry.bankStatus}</dd></div>}
        <div><dt>Customer</dt><dd><code>{data.action.subject}</code></dd></div>
        <div><dt>Reference</dt><dd><code>{data.action.id}</code></dd></div>
        <div><dt>Value when prepared</dt><dd>{data.action.usdCents === null ? "Unknown" : `$${(data.action.usdCents / 100).toFixed(2)}`}</dd></div>
        <div><dt>Created</dt><dd>{when(data.action.createdAt)}</dd></div>
        <div><dt>Submitted</dt><dd>{when(data.action.submittedAt)}</dd></div>
        <div><dt>Settled</dt><dd>{when(data.action.settledAt)}</dd></div>
        <div><dt>Last checked</dt><dd>{when(data.action.checkedAt)}</dd></div>
      </dl>
      <div className="actions">
        {source && <a className="button" href={source} target="_blank" rel="noreferrer">Transaction</a>}
        {delivery && <a className="button" href={delivery} target="_blank" rel="noreferrer">Delivery</a>}
        {(data.action.status === "submitted" || data.action.status === "settling") && <button type="button" className="button primary" disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? "Checking…" : "Check the chain now"}</button>}
      </div>
      {check.isError && <div className="notice error" role="alert">{check.error.message}</div>}
      <h3>Events</h3>
      <ol className="events">{data.events.map((event, index) => <li key={index}><strong>{event.type.replaceAll("_", " ")}</strong><span className="muted">{when(event.occurredAt)}</span>
        <code>{JSON.stringify(event.evidence)}</code></li>)}</ol>
      {!data.events.length && <p className="muted">No events recorded yet.</p>}
    </>}
  </aside>;
}

type Entry = { id: string; origin: "aura" | "incoming" | "aave" | "card"; label: string; amountText: string | null; statusText: string; status: string;
  createdAt: string; counterparty?: string; source: string; chainId: number; transactionHash?: string };
type History = { wallet: string; entries: Entry[]; sources: Record<"aura" | "incoming" | "aave" | "card", { status: string; partial: boolean }> };

const sourceNames = { incoming: "Money received from outside Aura", card: "Card payments", aave: "Aave history", aura: "Aura actions" } as const;

/** One customer's whole account history, as they see it in Transactions. Aura actions open their journey. */
function CustomerHistory({ subject, onOpen }: { subject: string; onOpen: (id: string) => void }) {
  const history = useQuery({ queryKey: ["history", subject], queryFn: () => api<History>(`customers/${encodeURIComponent(subject)}/history`) });
  const data = history.data;
  return <>
    <p className="muted">Everything on this account, as the customer sees it in Transactions: Aura actions, money received from outside Aura (read from the chain), card payments, and Aave history.</p>
    {history.isFetching && !data && <p className="muted">Reading the chain…</p>}
    {history.isError && <div className="notice error" role="alert">{history.error.message}</div>}
    {data && (Object.keys(sourceNames) as Array<keyof typeof sourceNames>).filter((key) => data.sources[key]?.status === "unavailable" || data.sources[key]?.partial).map((key) =>
      <div key={key} className="notice error" role="status">{sourceNames[key]} {data.sources[key].status === "unavailable" ? "can't be read right now, so some may be missing." : "shows only the most recent."}</div>)}
    {data && <div className="tableWrap"><table>
      <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">With</th><th scope="col">Source</th></tr></thead>
      <tbody>{data.entries.map((entry) => <tr key={`${entry.origin}:${entry.id}`} className={entry.origin === "aura" ? "clickable" : undefined} data-testid="ops-history-entry"
        onClick={entry.origin === "aura" ? () => onOpen(entry.id) : undefined}>
        <td>{when(entry.createdAt)}</td>
        <td>{entry.origin === "aura" ? <button type="button" className="link" onClick={(event) => { event.stopPropagation(); onOpen(entry.id); }}>{entry.label}</button> : entry.label}</td>
        <td>{entry.amountText ?? "—"}</td>
        <td><span className={`badge ${entry.status === "failed" ? "bad" : entry.status === "completed" ? "good" : "warn"}`}>{entry.statusText}</span></td>
        <td>{entry.counterparty ? <code>{short(entry.counterparty)}</code> : "—"}</td><td>{entry.source}</td></tr>)}</tbody>
    </table></div>}
    {data && !data.entries.length && <p className="muted">Nothing has moved on this account yet.</p>}
  </>;
}

export function Movement({ subject, onClearSubject }: { subject: string | null; onClearSubject: () => void }) {
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const filter = new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}), ...(stuck ? { stuck: "1" } : {}), ...(subject ? { subject } : {}) });
  const list = useInfiniteQuery({
    queryKey: ["actions", filter.toString()], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page>(`movement?${new URLSearchParams({ ...Object.fromEntries(filter), ...(pageParam ? { before: pageParam } : {}) })}`),
    getNextPageParam: (last) => last.next
  });
  const rows = list.data?.pages.flatMap((page) => page.rows) ?? [];
  if (subject) return <section className="panel" aria-labelledby="movement-heading">
    <h1 id="movement-heading">Money movement</h1>
    <div className="filters"><span className="chip">Customer <code>{short(subject)}</code><button type="button" className="button quiet" onClick={onClearSubject}>Show everyone</button></span></div>
    <CustomerHistory subject={subject} onOpen={setOpen} />
    {open && <Journey id={open} onClose={() => setOpen(null)} />}
  </section>;

  return <section className="panel" aria-labelledby="movement-heading">
    <h1 id="movement-heading">Money movement</h1>
    <p className="muted">Everything moving on Aura, newest first: Aura actions, money customers received from outside Aura as the chain showed it (recorded within a few minutes), and card payments as the card issuer reported them. Status and stuck filters show Aura actions only.</p>
    <div className="filters">
      <label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">All</option>{["submitted", "settling", "confirmed", "failed", "expired"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>Kind<select value={kind} onChange={(event) => setKind(event.target.value)}>
        <option value="">All</option><option value="transfer">Send, bank, card</option><option value="route">Swap or move</option><option value="earn">Earn</option><option value="received">Received from outside Aura</option><option value="card">Card payments</option></select></label>
      <label className="check"><input type="checkbox" checked={stuck} onChange={(event) => setStuck(event.target.checked)} />Stuck only</label>
      {subject && <span className="chip">Customer <code>{short(subject)}</code><button type="button" className="button quiet" onClick={onClearSubject}>Show everyone</button></span>}
    </div>
    {list.isError && <div className="notice error" role="alert">{list.error.message}</div>}
    <div className="tableWrap"><table>
      <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Customer</th><th scope="col">Source</th></tr></thead>
      <tbody>{rows.map((row) => {
        const link = row.origin === "incoming" ? txLink(row.chainId, row.transactionHash) : null;
        return <tr key={`${row.origin}:${row.id}`} className={row.origin === "aura" ? "clickable" : undefined} onClick={row.origin === "aura" ? () => setOpen(row.id) : undefined} data-testid="ops-action">
          <td>{when(row.createdAt)}</td>
          <td>{row.origin === "aura" ? <button type="button" className="link" onClick={(event) => { event.stopPropagation(); setOpen(row.id); }}>{row.label}</button>
            : link ? <a className="link" href={link} target="_blank" rel="noreferrer">{row.label}</a> : row.label}</td>
          <td>{row.amountText ?? "—"}</td>
          <td><span className={`badge ${row.status === "failed" ? "bad" : row.statusText === "Completed" ? "good" : "warn"}`}>{row.statusText}</span></td>
          <td><code>{short(row.subject)}</code></td><td>{row.source}</td></tr>;
      })}</tbody>
    </table></div>
    {list.isSuccess && !rows.length && <p className="muted">Nothing matches.</p>}
    {list.hasNextPage && <button type="button" className="button" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "Loading…" : "Load more"}</button>}
    {open && <Journey id={open} onClose={() => setOpen(null)} />}
  </section>;
}
