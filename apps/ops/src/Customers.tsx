import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api, when } from "./api";

type Holding = { label: string; symbol: string; amountRaw: string | null; status: string };
type Account = { subjectReference: string; wallet: string; closedAt: string | null; closedReason: string | null; eligible: boolean; blockers: string[];
  holdings: Holding[]; observedAt: string };
type Profile = { subjectReference: string; createdAt: string | null; closedAt: string | null;
  controls: { accountLocked: boolean; dailyLimitUsd: number | null; enforceAddressBook: boolean; updatedAt: string | null };
  auraTag: string | null; bank: { status: string; kycStatus: string | null } | null; card: { status: string; lastFour: string | null } | null;
  actions: { total: number; completed: number; failed: number; open: number; lastAt: string | null }; intercomUserId: string };
type Lookup = { account: Account; profile: Profile };

/** One operator action on an account, with the reason every one of them needs. */
function ReasonAction({ label, disabled, onSubmit, pending }: { label: string; disabled?: boolean; pending: boolean; onSubmit: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <button className="button" disabled={disabled} onClick={() => setOpen(true)}>{label}</button>;
  return <form className="reason" onSubmit={(event) => { event.preventDefault(); onSubmit(reason.trim()); }} aria-label={label}>
    <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Intercom conversation, or what the customer asked" autoFocus /></label>
    <button className="button primary" disabled={pending || reason.trim().length < 4}>{pending ? "Working…" : `Confirm: ${label.toLowerCase()}`}</button>
    <button type="button" className="button quiet" onClick={() => setOpen(false)}>Cancel</button>
  </form>;
}

export function Customers({ onMovement }: { onMovement: (subject: string) => void }) {
  const client = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const lookup = useQuery({ queryKey: ["customer", query], queryFn: () => api<Lookup>(`accounts?q=${encodeURIComponent(query)}`), enabled: query.length > 0 });
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: "lock" | "close" | "reopen"; reason: string }) =>
      api(`accounts/${encodeURIComponent(lookup.data!.account.subjectReference)}/${action}`, { method: "POST", json: { reason } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["customer", query] })
  });
  function find(event: FormEvent) { event.preventDefault(); act.reset(); if (input.trim() === query) void lookup.refetch(); else setQuery(input.trim()); }
  const data = lookup.data;
  const profile = data?.profile;

  return <section className="panel" aria-labelledby="customers-heading">
    <h1 id="customers-heading">Customers</h1>
    <form className="search" onSubmit={find}>
      <label>Customer<input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Privy user ID, email, wallet address, or Aura tag" /></label>
      <button className="button primary" disabled={input.trim().length < 3}>Find</button>
    </form>
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
          <button className="icon" aria-label="Copy Intercom user ID" onClick={() => { void navigator.clipboard?.writeText(profile.intercomUserId); setCopied(true); }}><Copy size={14} /></button>
          {copied && <span className="muted"> Copied</span>}</dd></div>
        {data.account.closedAt && <div><dt>Closed</dt><dd>{when(data.account.closedAt)}: {data.account.closedReason}</dd></div>}
      </dl>
      <h3>Holdings <span className="muted">read from the chain {when(data.account.observedAt)}</span></h3>
      <ul className="holdings">{data.account.holdings.map((holding) => <li key={holding.label}>
        <span>{holding.label}</span><span>{holding.status !== "observed" ? "Unavailable" : holding.amountRaw === "0" ? "Empty" : `Holds ${holding.symbol}`}</span></li>)}</ul>
      {!data.account.closedAt && !data.account.eligible && <p className="muted">Can&apos;t close yet: {data.account.blockers.join("; ")}.</p>}
      <div className="actions">
        <button className="button" onClick={() => onMovement(profile.subjectReference)}>Money movement</button>
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
