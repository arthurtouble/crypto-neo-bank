"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";

type Action = "supply" | "withdraw" | "borrow" | "repay";
type Symbol = "USDC" | "WETH";
type Preview = { action: Action; symbol: Symbol; amount: string; observedAt: string;
  postHealthFactor: number | null; debtStatus: "none" | "positive" | "unresolved";
  approvalRequired: boolean; simulation: "passed" | "after_approval"; executionAvailable: false };

const labels: Record<Action, string> = { supply: "Supply", withdraw: "Withdraw", borrow: "Borrow", repay: "Repay" };

export function AaveActionPreview({ walletAddress, actions, symbols }: {
  walletAddress?: string; actions: readonly Action[]; symbols: readonly Symbol[];
}) {
  const { getAccessToken } = usePrivy();
  const [action, setAction] = useState<Action>(actions[0]);
  const [symbol, setSymbol] = useState<Symbol>(symbols[0]);
  const [amount, setAmount] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function check(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreview(null); setError(""); setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token || !walletAddress) throw new Error("Sign in to check your position.");
      const response = await fetch("/api/defi/aave/preview", { method: "POST", cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, sender: walletAddress, symbol, amount }) });
      if (!response.ok) throw new Error("Current Aave risk could not be confirmed. Check your amount or try again later.");
      setPreview(await response.json() as Preview);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Preview unavailable."); }
    finally { setBusy(false); }
  }

  return <form className="aavePreviewForm" onSubmit={(event) => void check(event)}>
    <div className="aavePreviewFields">
      <label>Action<select value={action} onChange={(event) => { setAction(event.target.value as Action); setPreview(null); }}>
        {actions.map((item) => <option key={item} value={item}>{labels[item]}</option>)}
      </select></label>
      {symbols.length > 1 && <label>Asset<select value={symbol} onChange={(event) => { setSymbol(event.target.value as Symbol); setPreview(null); }}>
        {symbols.map((item) => <option key={item} value={item}>{item}</option>)}
      </select></label>}
      <label>Amount<input type="text" inputMode="decimal" autoComplete="off" value={amount}
        onChange={(event) => { setAmount(event.target.value); setPreview(null); }} placeholder={`0 ${symbol}`} required /></label>
    </div>
    <button className="button secondary" type="submit" disabled={busy || !walletAddress || !amount.trim()}>{busy ? "Checking…" : "Preview risk"}</button>
    {error && <p className="formError" role="alert">{error}</p>}
    {preview && <div className="aavePreviewResult" role="status">
      <strong>{labels[preview.action]} {preview.amount} {preview.symbol}</strong>
      <span>{preview.debtStatus === "none" ? "No debt after this action" : preview.postHealthFactor === null ? "Final debt requires settlement" : `Estimated health factor ${preview.postHealthFactor.toFixed(2)}`}</span>
      {preview.approvalRequired && <span>An exact token approval would be needed first.</span>}
      {preview.simulation === "passed" && <span>The exact call passed a same-block revert check.</span>}
      <small>Observed {new Date(preview.observedAt).toLocaleTimeString()} · Preview only; no transaction was prepared.</small>
    </div>}
  </form>;
}
