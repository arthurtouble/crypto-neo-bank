"use client";

import Link from "next/link";
import { useState } from "react";
import { useAction } from "@/lib/client/use-action";
import { useSkyPosition } from "@/lib/defi/use-sky-position";
import { TransactionProgress } from "./transaction-progress";

type Direction = "deposit" | "withdraw";
const labels: Record<Direction, string> = { deposit: "Deposit", withdraw: "Withdraw" };

export function SkyVaultCard() {
  const [direction, setDirection] = useState<Direction>("deposit");
  const earn = useAction({ label: labels[direction] });
  const walletAddress = earn.wallet.address;
  const [amount, setAmount] = useState("");
  const position = useSkyPosition(walletAddress);
  const locked = earn.phase !== "idle" && earn.phase !== "done" || earn.outcomeUnknown;

  async function execute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || !amount.trim()) return;
    await earn.run({ kind: "earn", protocol: "sky", direction, asset: "USDC", amount: amount.trim() });
  }

  function edit(change: () => void) { change(); if (earn.phase === "done" || earn.error && !earn.outcomeUnknown) earn.reset(); }

  return <article className="panel strategyCard">
    <div className="strategyTop"><span className="strategyGlyph">S</span><span className="statusBadge neutral"><i /> Sky on Ethereum</span></div>
    <p className="eyebrow">SKY SAVINGS</p><h2>Save with USDC</h2>
    <p>Deposit Ethereum USDC into Sky sUSDS. Sky converts it in the same transaction. Withdraw back to USDC.</p>
    <div className="strategyMetrics"><div><span>USDC on Ethereum</span><strong>{position.data?.usdc ?? (position.isError ? "Unavailable" : "—")}</strong></div>
      <div><span>Sky position</span><strong>{position.data?.susds ?? (position.isError ? "Unavailable" : "—")} USDS</strong></div></div>
    <form className="aavePreviewForm" onSubmit={(event) => void execute(event)}>
      <div className="aavePreviewFields"><label>Action<select value={direction} disabled={locked} onChange={(event) => edit(() => setDirection(event.target.value as Direction))}>
        <option value="deposit">Deposit</option><option value="withdraw">Withdraw</option></select></label>
        <label>USDC amount<input type="text" inputMode="decimal" value={amount} autoComplete="off" required disabled={locked}
          onChange={(event) => edit(() => setAmount(event.target.value))} placeholder="0 USDC" /></label></div>
      <button className="button primary" type="submit" disabled={locked || earn.phase === "done" || !walletAddress || !amount.trim()}>
        {earn.phase === "preparing" ? "Checking" : earn.phase === "signing" ? "Confirm in your wallet" : earn.phase === "tracking" ? "Waiting for Ethereum"
          : earn.outcomeUnknown ? "Check Transactions first" : labels[direction]}</button>
      <TransactionProgress label={labels[direction]} phase={earn.phase} action={earn.action} outcomeUnknown={earn.outcomeUnknown} />
    </form>
    <p className="authorityFootnote">Ethereum ETH pays network fees. Need USDC there? <Link href="/app/swap?from=8453%3A0x833589fcd6edb6e08f4c7c32d4f71b54bda02913&to=1%3A0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48">Bridge from Base</Link>.</p>
  </article>;
}
