"use client";

import { useState } from "react";
import { useAction } from "@/lib/client/use-action";
import { TransactionProgress } from "./transaction-progress";

/** Where the money goes: an Aave reserve on Base, or a Morpho vault on Base. */
export type EarnOption = { protocol: "aave"; asset: "USDC" | "WETH"; label: string } | { protocol: "morpho"; vault: string; label: string };
type Direction = "deposit" | "withdraw";

const labels: Record<Direction, string> = { deposit: "Deposit", withdraw: "Withdraw" };

/**
 * Deposit to or withdraw from one Earn option. A deposit approves and deposits
 * in one confirmation. From a Morpho vault, "Withdraw all" redeems every share.
 */
export function EarnAction({ option, symbol, hasPosition }: { option: EarnOption; symbol: string; hasPosition: boolean }) {
  const [direction, setDirection] = useState<Direction>("deposit");
  const earn = useAction({ label: labels[direction] });
  const [amount, setAmount] = useState("");
  // Once it has left the account it's sent; Transactions tracks the rest, as in Send and Swap.
  const handedOff = earn.action?.status === "settling";
  const locked = (earn.phase !== "idle" && earn.phase !== "done" && !handedOff) || earn.outcomeUnknown;

  async function submit(all = false) {
    if (locked || (!all && !amount.trim())) return;
    const value = all ? "all" : amount.trim();
    await earn.run(option.protocol === "aave"
      ? { kind: "earn", protocol: "aave", direction, asset: option.asset, amount: value }
      : { kind: "earn", protocol: "morpho", direction, vault: option.vault, amount: value });
  }

  function edit(change: () => void) { change(); if (earn.phase === "done" || handedOff || (earn.error && !earn.outcomeUnknown)) earn.reset(); }

  return <form className="aavePreviewForm" aria-label={`${option.label}: deposit or withdraw`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="aavePreviewFields">
      <label>Action<select value={direction} disabled={locked} onChange={(event) => edit(() => setDirection(event.target.value as Direction))}>
        <option value="deposit">Deposit</option><option value="withdraw">Withdraw</option>
      </select></label>
      <label>Amount<input type="text" inputMode="decimal" autoComplete="off" value={amount} disabled={locked}
        onChange={(event) => edit(() => setAmount(event.target.value))} placeholder={`0 ${symbol}`} /></label>
    </div>
    <div className="aavePreviewButtons">
      <button className="button primary" type="submit" disabled={locked || !earn.wallet.address || !amount.trim()}>
        {earn.phase === "preparing" ? "Checking" : earn.phase === "signing" ? "Confirm with your passkey" : earn.outcomeUnknown ? "Check Transactions first" : labels[direction]}
      </button>
      {option.protocol === "morpho" && direction === "withdraw" && hasPosition &&
        <button className="button secondary" type="button" disabled={locked || !earn.wallet.address} onClick={() => void submit(true)}>Withdraw all</button>}
    </div>
    <TransactionProgress label={labels[direction]} phase={earn.phase} action={earn.action} outcomeUnknown={earn.outcomeUnknown} />
  </form>;
}
