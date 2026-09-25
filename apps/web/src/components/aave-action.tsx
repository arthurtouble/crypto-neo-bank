"use client";

import { useState } from "react";
import { useAction } from "@/lib/client/use-action";
import { TransactionProgress } from "./transaction-progress";

type Direction = "supply" | "withdraw";
type Symbol = "USDC" | "WETH";

const labels: Record<Direction, string> = { supply: "Supply", withdraw: "Withdraw" };

/** Supply to or withdraw from Aave on Base. A supply approves and supplies in one confirmation. */
export function AaveAction({ actions, symbols }: { actions: readonly Direction[]; symbols: readonly Symbol[] }) {
  const earn = useAction();
  const [direction, setDirection] = useState<Direction>(actions[0]);
  const [symbol, setSymbol] = useState<Symbol>(symbols[0]);
  const [amount, setAmount] = useState("");
  const locked = earn.phase !== "idle" && earn.phase !== "done" || earn.outcomeUnknown;

  async function execute(event: React.FormEvent) {
    event.preventDefault();
    if (locked || !amount.trim()) return;
    await earn.run({ kind: "earn", protocol: "aave", direction: direction === "supply" ? "deposit" : "withdraw", asset: symbol, amount: amount.trim() },
      () => ({ description: `${labels[direction]} ${amount.trim()} ${symbol} with Aave on Base.`, buttonText: labels[direction] }));
  }

  function edit(change: () => void) { change(); if (earn.phase === "done" || earn.error && !earn.outcomeUnknown) earn.reset(); }

  return <form className="aavePreviewForm" onSubmit={(event) => void execute(event)}>
    <div className="aavePreviewFields">
      <label>Action<select value={direction} disabled={locked} onChange={(event) => edit(() => setDirection(event.target.value as Direction))}>
        {actions.map((item) => <option key={item} value={item}>{labels[item]}</option>)}
      </select></label>
      {symbols.length > 1 && <label>Asset<select value={symbol} disabled={locked} onChange={(event) => edit(() => setSymbol(event.target.value as Symbol))}>
        {symbols.map((item) => <option key={item} value={item}>{item}</option>)}
      </select></label>}
      <label>Amount<input type="text" inputMode="decimal" autoComplete="off" value={amount} disabled={locked}
        onChange={(event) => edit(() => setAmount(event.target.value))} placeholder={`0 ${symbol}`} required /></label>
    </div>
    <div className="aavePreviewButtons">
      <button className="button primary" type="submit" disabled={locked || earn.phase === "done" || !earn.wallet.address || !amount.trim()}>
        {earn.phase === "preparing" ? "Checking" : earn.phase === "signing" ? "Confirm in your wallet" : earn.phase === "tracking" ? "Waiting for the network"
          : earn.outcomeUnknown ? "Check Transactions first" : labels[direction]}
      </button>
    </div>
    <TransactionProgress label={labels[direction]} phase={earn.phase} action={earn.action} error={earn.error} outcomeUnknown={earn.outcomeUnknown} />
  </form>;
}
