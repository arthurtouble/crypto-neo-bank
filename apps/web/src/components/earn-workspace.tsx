"use client";

import { usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, ExternalLink, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import { HOME_CHAIN } from "@/config/chains";
import type { AaveBaseReserve } from "@/lib/defi/aave";
import { collectUnsignedTransactions } from "@/lib/transactions/plan";

type MarketResponse = { market: string; chainId: number; name: string; reserves: AaveBaseReserve[]; observedAt: string; authority: string };
export function EarnWorkspace() {
  const { wallets } = useWallets();
  const { getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const [selected, setSelected] = useState<AaveBaseReserve | null>(null);
  const [amount, setAmount] = useState("");
  const [collateral, setCollateral] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hashes, setHashes] = useState<string[]>([]);

  const market = useQuery<MarketResponse>({
    queryKey: ["aave-base-market", wallet?.address],
    queryFn: async () => {
      const response = await fetch(`/api/defi/aave/markets${wallet?.address ? `?address=${wallet.address}` : ""}`);
      if (!response.ok) throw new Error("Live Aave market data is unavailable.");
      return response.json() as Promise<MarketResponse>;
    },
    refetchInterval: 60_000
  });

  async function supply(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || !wallet || !amount || Number(amount) <= 0) return;
    setWorking(true); setError(null); setHashes([]);
    let intentId: string | undefined;
    let token: string | null = null;
    try {
      token = await getAccessToken();
      if (!token) throw new Error("Your secure session expired.");
      const intentResponse = await fetch("/api/intents/evaluate", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "earn_supply", walletAddress: wallet.address, chainId: 8453, asset: selected.symbol, amount, destination: market.data?.market, estimatedUsd: selected.symbol === "USDC" ? Number(amount) : undefined })
      });
      const intent = await intentResponse.json() as { intentId?: string; message?: string };
      if (!intentResponse.ok || !intent.intentId) throw new Error(intent.message ?? "The allocation did not pass policy review.");
      intentId = intent.intentId;

      const planResponse = await fetch("/api/defi/aave/action", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "supply", sender: wallet.address, symbol: selected.symbol, amount, enableCollateral: collateral })
      });
      const prepared = await planResponse.json() as { plan?: unknown; message?: string };
      if (!planResponse.ok || !prepared.plan) throw new Error(prepared.message ?? "Aave could not prepare this allocation.");
      const transactions = collectUnsignedTransactions(prepared.plan, HOME_CHAIN.id);
      if (!transactions.length) throw new Error("Aave returned no executable transaction. The wallet may not have enough of this asset.");

      const submitted: string[] = [];
      const client = createPublicClient({ chain: HOME_CHAIN, transport: http() });
      for (const [index, transaction] of transactions.entries()) {
        const result = await sendTransaction(transaction, { address: wallet.address, uiOptions: { description: `Aave ${selected.symbol} allocation on Base mainnet.`, buttonText: "Confirm with wallet", isCancellable: true } });
        submitted.push(result.hash);
        if (index < transactions.length - 1) {
          const receipt = await client.waitForTransactionReceipt({ hash: result.hash, confirmations: 1, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error("A prerequisite transaction reverted. The supply transaction was not submitted.");
        }
      }
      setHashes(submitted);
      await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId, status: "submitted", transactionHash: submitted.at(-1) }) });
      void market.refetch();
    } catch (caught) {
      if (intentId && token) await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId, status: "cancelled" }) }).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : "The allocation was not submitted.");
    } finally { setWorking(false); }
  }

  return <>
    <div className="notice"><ShieldCheck size={18} /><span><strong>Productive by choice.</strong> Live Aave positions are self-custodial and user-signed. Rates vary, smart-contract risk exists, and principal is not guaranteed.</span></div>
    {market.isPending && <section className="panel walletLoading"><LoaderCircle className="spin" size={20} /><div><strong>Reading Base markets</strong><span>Fetching authoritative Aave liquidity and rates.</span></div></section>}
    {market.error && <div className="sandboxAlert error" role="alert">{market.error.message}</div>}
    <div className="strategyGrid">
      {market.data?.reserves.map((reserve) => <article className="panel strategyCard" key={reserve.symbol}>
        <div className="strategyTop"><span className="strategyGlyph">A3</span><span className="statusBadge good"><i /> Live</span></div>
        <p className="eyebrow">AAVE V3 · BASE</p><h2>{reserve.symbol} lending</h2>
        <p>Supply {reserve.symbol} directly to the governed Aave Base market. Aurel never takes custody or operates an intermediary vault.</p>
        <div className="strategyMetrics"><div><span>Supply APY</span><strong>{reserve.supplyApyPct}%</strong></div><div><span>Liquidity</span><strong>${(Number(reserve.availableLiquidity.usd) / 1_000_000).toFixed(1)}m</strong></div><div><span>Borrow APY</span><strong>{reserve.borrowApyPct}%</strong></div></div>
        <div className="exposureList"><span><Check size={13} /> Base mainnet</span><span><Check size={13} /> Aave governance</span><span><Check size={13} /> Withdraw subject to liquidity</span></div>
        <button className="button primary full" disabled={!reserve.canSupply} onClick={() => { setSelected(reserve); setAmount(""); setError(null); setHashes([]); }}>Review allocation <ArrowRight size={15} /></button>
      </article>)}
    </div>
    {market.data && <p className="authorityFootnote">Observed {new Date(market.data.observedAt).toLocaleTimeString()} · Authority: {market.data.authority} · Spot APY is not a forecast.</p>}

    {selected && <div className="modalBackdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><section className="financialModal" role="dialog" aria-modal="true" aria-labelledby="earn-title">
      <button className="modalClose" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button>
      <form onSubmit={(event) => void supply(event)}><p className="eyebrow">AAVE V3 · BASE MAINNET</p><h2 id="earn-title">Supply {selected.symbol}</h2>
        <p>This creates a direct position from your wallet. Aave may require an approval transaction followed by the supply transaction; Privy will ask you to confirm each one.</p>
        <label className="fieldLabel">Amount<input inputMode="decimal" placeholder={`0.00 ${selected.symbol}`} value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label className="consentCheck"><input type="checkbox" checked={collateral} onChange={(event) => setCollateral(event.target.checked)} /><span><strong>Enable as collateral</strong><small>This may support future borrowing but introduces liquidation risk once debt exists.</small></span></label>
        <div className="transactionSummary"><span>Current supply APY<strong>{selected.supplyApyPct}%</strong></span><span>Protocol<strong>Aave V3</strong></span><span>Control<strong>Your wallet</strong></span></div>
        {error && <div className="formError" role="alert">{error}</div>}
        {hashes.map((hash) => <a key={hash} className="transactionSuccess" href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer"><Check size={16} /> Submitted · {hash.slice(0, 10)}… <ExternalLink size={14} /></a>)}
        <button className="button primary full" disabled={working || Boolean(hashes.length)}>{working ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{working ? "Preparing securely" : hashes.length ? "Submitted" : "Review and sign"}</button>
      </form>
    </section></div>}
  </>;
}
