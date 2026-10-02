"use client";

import { useState } from "react";
import { useAction } from "@/lib/client/use-action";
import { formatToken } from "@/lib/format";
import { formatUnits } from "@/lib/format/units";
import { TransactionProgress } from "./transaction-progress";

/** Where the money goes: an Aave reserve on Base, or a Morpho vault on Base. */
export type EarnOption = { protocol: "aave"; asset: "USDC" | "WETH"; label: string } | { protocol: "morpho"; vault: string; label: string };
type Direction = "deposit" | "withdraw";

const labels: Record<Direction, string> = { deposit: "Deposit", withdraw: "Withdraw" };

/**
 * Deposit to or withdraw from one Earn option, on two tabs (withdraw only, without tabs, for an option closed to deposits). Deposit shows what the account holds, with Max; Withdraw
 * shows what's in this option, with "Withdraw all", which takes out everything, interest included: the whole Aave
 * balance, or every vault share. A deposit approves and deposits in one confirmation. Balances are null when they
 * can't be read, and then say so. The amount clears once the money has moved.
 */
export function EarnAction({ option, symbol, decimals, hasPosition, walletRaw, positionRaw, withdrawOnly = false }: {
  option: EarnOption; symbol: string; decimals: number; hasPosition: boolean; walletRaw: string | null; positionRaw: string | null; withdrawOnly?: boolean;
}) {
  const [direction, setDirection] = useState<Direction>(withdrawOnly ? "withdraw" : "deposit");
  const earn = useAction({ label: labels[direction] });
  const [amount, setAmount] = useState("");
  // Once it has left the account it's sent; Transactions tracks the rest, as in Send and Swap.
  const handedOff = earn.action?.status === "settling";
  const locked = (earn.phase !== "idle" && earn.phase !== "done" && !handedOff) || earn.outcomeUnknown;
  const moved = earn.phase === "done" || handedOff;
  const [wasMoved, setWasMoved] = useState(false);
  if (moved !== wasMoved) { setWasMoved(moved); if (moved) setAmount(""); }

  const id = option.protocol === "aave" ? `aave-${option.asset}` : option.vault;
  const balanceRaw = direction === "deposit" ? walletRaw : positionRaw;
  const balanceText = balanceRaw === null ? "unavailable" : formatToken(formatUnits(BigInt(balanceRaw), decimals), symbol, { maxDecimals: 6 });

  async function submit(all = false) {
    if (locked || (!all && !amount.trim())) return;
    const value = all ? "all" : amount.trim();
    await earn.run(option.protocol === "aave"
      ? { kind: "earn", protocol: "aave", direction, asset: option.asset, amount: value }
      : { kind: "earn", protocol: "morpho", direction, vault: option.vault, amount: value });
  }

  function edit(change: () => void) { change(); if (moved || (earn.error && !earn.outcomeUnknown)) earn.reset(); }

  return <form className="mxForm erForm" aria-label={`${option.label}: deposit or withdraw`} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    {!withdrawOnly && <div className="appSegmented erTabs" role="tablist" aria-label="Deposit or withdraw">
      {(["deposit", "withdraw"] as const).map((item) => <button key={item} type="button" role="tab" id={`earn-tab-${id}-${item}`} aria-controls={`earn-panel-${id}`}
        aria-selected={direction === item} disabled={locked} onClick={() => edit(() => setDirection(item))}>{labels[item]}</button>)}
    </div>}
    <div className="mxFieldGroup" role={withdrawOnly ? undefined : "tabpanel"} id={`earn-panel-${id}`} aria-labelledby={withdrawOnly ? undefined : `earn-tab-${id}-${direction}`}>
      <div className="mxAmountWithMax">
        <label className="mxField">Amount in {symbol}<input type="text" inputMode="decimal" autoComplete="off" value={amount} disabled={locked}
          aria-describedby={`earn-balance-${id}`} onChange={(event) => edit(() => setAmount(event.target.value))} placeholder="0.00" /></label>
        {direction === "deposit" && walletRaw !== null && walletRaw !== "0" && <button type="button" className="appButton mxMaxButton" disabled={locked}
          onClick={() => edit(() => setAmount(formatUnits(BigInt(walletRaw), decimals)))}>Max</button>}
      </div>
      <span className="mxHint" id={`earn-balance-${id}`}>{direction === "deposit" ? `In your account: ${balanceText}` : `In ${option.label}: ${balanceText}`}</span>
    </div>
    <div className="mxActions">
      <button className="appButton appButtonPrimary" type="submit" disabled={locked || !earn.wallet.address || !amount.trim()}>
        {earn.phase === "preparing" ? "Checking" : earn.phase === "signing" ? "Confirm with your passkey" : earn.outcomeUnknown ? "Check Transactions first" : labels[direction]}
      </button>
      {direction === "withdraw" && hasPosition &&
        <button className="appButton" type="button" disabled={locked || !earn.wallet.address} onClick={() => void submit(true)}>Withdraw all</button>}
    </div>
    <TransactionProgress label={labels[direction]} phase={earn.phase} action={earn.action} outcomeUnknown={earn.outcomeUnknown} />
  </form>;
}
