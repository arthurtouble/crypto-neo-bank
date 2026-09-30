import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, short, when } from "./api";

type Holding = { label: string; symbol: string; amountRaw: string | null; status: string };
type Account = { subjectReference: string; wallet: string; closedAt: string | null; closedReason: string | null; eligible: boolean; blockers: string[];
  holdings: Holding[]; observedAt: string };
type Profile = { subjectReference: string; createdAt: string | null; closedAt: string | null;
  controls: { accountLocked: boolean; dailyLimitUsd: number | null; enforceAddressBook: boolean; updatedAt: string | null };
  auraTag: string | null; bank: { status: string; kycStatus: string | null } | null; card: { status: string; lastFour: string | null } | null;
  actions: { total: number; completed: number; failed: number; open: number; lastAt: string | null }; intercomUserId: string;
  notices: { recent: Notice[]; emailFailed: number } };
type Notice = { id: string; kind: string; title: string; createdAt: string; email: string; push: string };

const deliveryWords: Record<string, string> = { sent: "Sent", failed: "Failed", skipped: "Not sent", pending: "Sending" };
/** How one channel went: failed stands out, since that's what support needs to see. */
function Delivery({ status }: { status: string }) {
  const word = deliveryWords[status] ?? status;
  return status === "failed" ? <span className="badge bad">{word}</span> : <span className={status === "sent" ? undefined : "muted"}>{word}</span>;
}
type Lookup = { account: Account; profile: Profile };

/** One operator action on an account, with the reason every one of them needs. */
function ReasonAction({ label, disabled, onSubmit, pending }: { label: string; disabled?: boolean; pending: boolean; onSubmit: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button type="button" className="button" disabled={disabled} onClick={() => setOpen(true)}>{label}</button>;
  return <form className="reason" onSubmit={(event) => { event.preventDefault(); onSubmit(reason.trim()); }} aria-label={label}>
    <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Intercom conversation, or what the customer asked" autoFocus /></label>
    <button type="submit" className="button primary" disabled={pending || reason.trim().length < 4}>{pending ? "Working…" : `Confirm: ${label.toLowerCase()}`}</button>
    <button type="button" className="button quiet" onClick={() => setOpen(false)}>Cancel</button>
  </form>;
}

type Row = { subjectReference: string; createdAt: string; closedAt: string | null; accountLocked: boolean; auraTag: string | null;
  bankStatus: string | null; cardStatus: string | null; actions: number; lastActivityAt: string | null };

/** Every customer, newest sign-up first, 50 at a time. */
function AllCustomers({ onOpen }: { onOpen: (subject: string) => void }) {
  const list = useInfiniteQuery({
    queryKey: ["customers"], initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<{ customers: Row[]; next: string | null }>(`customers${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.next
  });
  const rows = list.data?.pages.flatMap((page) => page.customers) ?? [];
  return <section aria-labelledby="all-customers-heading">
    <h2 id="all-customers-heading">All customers</h2>
    {list.isError && <div className="notice error" role="alert">{list.error.message}</div>}
    <div className="tableWrap"><table>
      <thead><tr><th scope="col">Joined</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Bank</th><th scope="col">Card</th>
        <th scope="col">Transactions</th><th scope="col">Last activity</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.subjectReference} className="clickable" onClick={() => onOpen(row.subjectReference)} data-testid="ops-customer-row">
        <td>{when(row.createdAt)}</td>
        <td><button type="button" className="link" onClick={(event) => { event.stopPropagation(); onOpen(row.subjectReference); }}>{row.auraTag ? `@${row.auraTag}` : short(row.subjectReference)}</button></td>
        <td>{row.closedAt ? <span className="badge bad">Closed</span> : row.accountLocked ? <span className="badge warn">Locked</span> : <span className="badge good">Open</span>}</td>
        <td>{row.bankStatus ?? "—"}</td><td>{row.cardStatus ?? "—"}</td><td>{row.actions}</td><td>{when(row.lastActivityAt)}</td></tr>)}</tbody>
    </table></div>
    {list.isSuccess && !rows.length && <p className="muted">No customers yet.</p>}
    {list.hasNextPage && <button type="button" className="button" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "Loading…" : "Load more"}</button>}
  </section>;
}

export function Customers({ onMovement }: { onMovement: (subject: string) => void }) {
  const client = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<"" | "copied" | "failed">("");
  const lookup = useQuery({ queryKey: ["customer", query], queryFn: () => api<Lookup>(`accounts?q=${encodeURIComponent(query)}`), enabled: query.length > 0 });
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: "lock" | "close" | "reopen"; reason: string }) =>
      api(`accounts/${encodeURIComponent(lookup.data!.account.subjectReference)}/${action}`, { method: "POST", json: { reason } }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["customer", query] }); void client.invalidateQueries({ queryKey: ["customers"] }); }
  });
  const open = (subject: string) => { act.reset(); setInput(subject); setQuery(subject); };
  const showAll = () => { act.reset(); setInput(""); setQuery(""); };
  function find(event: FormEvent) { event.preventDefault(); act.reset(); if (input.trim() === query) void lookup.refetch(); else setQuery(input.trim()); }
  const data = lookup.data;
  const profile = data?.profile;

  return <section className="panel" aria-labelledby="customers-heading">
    <h1 id="customers-heading">Customers</h1>
    <form className="search" onSubmit={find}>
      <label>Customer<input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Privy user ID, email, wallet address, or Aura tag" /></label>
      <button type="submit" className="button primary" disabled={input.trim().length < 3}>Find</button>
      {query && <button type="button" className="button quiet" onClick={showAll}>All customers</button>}
    </form>
    {!query && <AllCustomers onOpen={open} />}
    {lookup.isFetching && <p className="muted">Looking up…</p>}
    {lookup.isError && <div className="notice error" role="alert">{lookup.error.message}</div>}
    {data && profile && <article className="customer" data-testid="ops-customer">
      <header>
        <div><h2>{profile.auraTag ? `@${profile.auraTag}` : "Customer"}</h2><code>{profile.subjectReference}</code></div>
        <div className="badges">
          {data.account.closedAt ? <span className="badge bad">Closed</span> : <span className="badge good">Open</span>}
          {profile.controls.accountLocked && <span className="badge warn">Locked</span>}
        </div>
      </header>
      <dl className="facts">
        <div><dt>Joined</dt><dd>{when(profile.createdAt)}</dd></div>
        <div><dt>Wallet</dt><dd><code>{data.account.wallet}</code></dd></div>
        <div><dt>Bank (Bridge)</dt><dd>{profile.bank ? `${profile.bank.status}${profile.bank.kycStatus ? `, identity ${profile.bank.kycStatus}` : ""}` : "Not started"}</dd></div>
        <div><dt>Card</dt><dd>{profile.card ? `${profile.card.status}${profile.card.lastFour ? `, ending ${profile.card.lastFour}` : ""}` : "None"}</dd></div>
        <div><dt>Daily limit</dt><dd>{profile.controls.dailyLimitUsd === null ? "None" : `$${profile.controls.dailyLimitUsd}`}{profile.controls.enforceAddressBook ? ", saved recipients only" : ""}</dd></div>
        <div><dt>Transactions</dt><dd>{profile.actions.total} ({profile.actions.completed} completed, {profile.actions.failed} failed, {profile.actions.open} open)</dd></div>
        <div><dt>Intercom user ID</dt><dd><code>{profile.intercomUserId}</code>
          <button type="button" className="icon" aria-label="Copy Intercom user ID" onClick={() => {
            if (!navigator.clipboard) { setCopied("failed"); return; }
            navigator.clipboard.writeText(profile.intercomUserId).then(() => setCopied("copied"), () => setCopied("failed"));
          }}><Copy size={14} /></button>
          <span className="muted" role="status">{copied === "copied" ? " Copied" : copied === "failed" ? " Couldn't copy. Select the ID and copy it instead." : ""}</span></dd></div>
        {data.account.closedAt && <div><dt>Closed</dt><dd>{when(data.account.closedAt)}: {data.account.closedReason}</dd></div>}
      </dl>
      <h3>Notices {profile.notices.emailFailed > 0 && <span className="badge bad">{profile.notices.emailFailed} email{profile.notices.emailFailed === 1 ? "" : "s"} failed</span>}</h3>
      {profile.notices.recent.length ? <div className="tableWrap"><table data-testid="ops-notices">
        <thead><tr><th scope="col">When</th><th scope="col">Notice</th><th scope="col">Email</th><th scope="col">Push</th></tr></thead>
        <tbody>{profile.notices.recent.map((notice) => <tr key={notice.id}><td>{when(notice.createdAt)}</td><td>{notice.title}</td>
          <td><Delivery status={notice.email} /></td><td><Delivery status={notice.push} /></td></tr>)}</tbody>
      </table></div> : <p className="muted">No notices yet.</p>}
      {profile.notices.emailFailed > 0 && <p className="muted">A failed email was refused or bounced by the customer&apos;s mail server. The notice is still in their app.</p>}
      <h3>Holdings <span className="muted">read from the chain {when(data.account.observedAt)}</span></h3>
      <ul className="holdings">{data.account.holdings.map((holding) => <li key={holding.label}>
        <span>{holding.label}</span><span>{holding.status !== "observed" ? "Unavailable" : holding.amountRaw === "0" ? "Empty" : `Holds ${holding.symbol}`}</span></li>)}</ul>
      {!data.account.closedAt && !data.account.eligible && <p className="muted">Can&apos;t close yet: {data.account.blockers.join("; ")}.</p>}
      <div className="actions">
        <button type="button" className="button" onClick={() => onMovement(profile.subjectReference)}>Money movement</button>
        {!profile.controls.accountLocked && !data.account.closedAt && <ReasonAction key="lock" label="Lock account" pending={act.isPending} onSubmit={(reason) => act.mutate({ action: "lock", reason })} />}
        {data.account.closedAt
          ? <ReasonAction key="reopen" label="Reopen account" pending={act.isPending} onSubmit={(reason) => act.mutate({ action: "reopen", reason })} />
          : <ReasonAction key="close" label="Close account" disabled={!data.account.eligible} pending={act.isPending} onSubmit={(reason) => act.mutate({ action: "close", reason })} />}
      </div>
      {act.isError && <div className="notice error" role="alert">{act.error.message}</div>}
      {act.isSuccess && <div className="notice" role="status">Done. The customer was told by email and in the app.</div>}
      <p className="muted">Only the customer unlocks their account, in Settings with their passkey. Locking freezes their card too.</p>
    </article>}
  </section>;
}
