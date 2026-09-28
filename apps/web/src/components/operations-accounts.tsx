"use client";

import { Check, LoaderCircle, Search, UserX } from "lucide-react";
import { useState } from "react";
import { ApiError, useApi } from "@/lib/client/api";
import type { ClosureCheck } from "@/lib/account/closure";

/**
 * Close or reopen a customer's account at their request. Closing is only
 * possible when the account holds nothing and nothing is on its way; the
 * server checks again when you press the button.
 */
export function OperationsAccounts() {
  const api = useApi();
  const [query, setQuery] = useState("");
  const [account, setAccount] = useState<ClosureCheck | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function run(task: () => Promise<{ account: ClosureCheck }>) {
    setWorking(true); setMessage(null);
    try { setAccount((await task()).account); }
    catch (error) { setMessage(error instanceof ApiError ? error.message : "That didn't work. Try again."); }
    finally { setWorking(false); }
  }
  const find = (event: React.FormEvent) => { event.preventDefault(); setAccount(null); void run(() => api(`/api/ops/accounts?q=${encodeURIComponent(query.trim())}`)); };
  function change(kind: "close" | "reopen") {
    const reason = window.prompt(kind === "close" ? "Why is this account being closed? (for example, the support case)" : "Why is this account being reopened?")?.trim();
    if (!reason || !account) return;
    void run(() => api(`/api/ops/accounts/${encodeURIComponent(account.subjectReference)}/${kind}`, { method: "POST", json: { reason } }));
  }

  return <section className="panel flagManager" aria-label="Accounts">
    <div className="panelHeading"><div><p className="eyebrow">ACCOUNTS</p><h2>Close an account</h2>
      <p className="sourceCaption">When a customer asks support to close their account. It must hold nothing and have nothing in progress. Records are kept.</p></div><UserX size={19} /></div>
    <form className="addressForm" onSubmit={find}>
      <label className="fieldLabel">Customer<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email, wallet address, or Privy user ID" /></label>
      <button className="button secondary" disabled={working || query.trim().length < 3}>{working ? <LoaderCircle className="spin" size={14} /> : <Search size={14} />} Find</button>
    </form>
    {message && <div className="formError" role="alert">{message}</div>}
    {account && <div data-testid="ops-account">
      <div className="flagRow"><span><strong>{account.wallet}</strong><small>{account.subjectReference}</small></span>
        <b>{account.closedAt ? `Closed ${new Date(account.closedAt).toLocaleString()}` : "Open"}</b></div>
      {account.holdings.map((holding) => <div className="flagRow" key={holding.label}><span><strong>{holding.label}</strong></span>
        <small>{holding.status === "observed" ? `${holding.amountRaw} (raw units)` : "Unavailable"}</small></div>)}
      {account.closedAt ? <p className="sourceCaption">Reason: {account.closedReason}</p>
        : account.eligible ? <p className="sourceCaption"><Check size={13} /> Empty, with nothing in progress. It can be closed.</p>
          : <ul className="sourceCaption">{account.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
      {account.closedAt
        ? <button className="button secondary" disabled={working} onClick={() => change("reopen")}>Reopen account</button>
        : <button className="button secondary" disabled={working || !account.eligible} onClick={() => change("close")}>Close account</button>}
    </div>}
  </section>;
}
