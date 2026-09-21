"use client";

import { useMfa, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, ExternalLink, LoaderCircle, ShieldAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import { HOME_CHAIN } from "@/config/chains";
import type { AaveBaseReserve } from "@/lib/defi/aave";
import { collectUnsignedTransactions, collectWarnings, findStringField } from "@/lib/transactions/plan";

type Market = { market: string; reserves: AaveBaseReserve[]; observedAt: string };
type Action = "borrow" | "repay";
type Prepared = { preview: unknown; plan: unknown };

export function BorrowWorkspace() {
  const { wallets } = useWallets();
  const { getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const { mfaMethods } = useMfa();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action>("borrow");
  const [symbol, setSymbol] = useState<"USDC" | "WETH">("USDC");
  const [amount, setAmount] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hashes, setHashes] = useState<string[]>([]);
  const market = useQuery<Market>({ queryKey: ["aave-borrow-market", wallet?.address], queryFn: async () => { const response = await fetch(`/api/defi/aave/markets?address=${wallet?.address}`); if (!response.ok) throw new Error("Borrowing market unavailable."); return response.json(); }, enabled: Boolean(wallet), refetchInterval: 60_000 });
  const position = useQuery<unknown>({ queryKey: ["aave-position", wallet?.address], queryFn: async () => { const response = await fetch(`/api/defi/aave/positions?address=${wallet?.address}`); if (!response.ok) throw new Error("Position unavailable."); return response.json(); }, enabled: Boolean(wallet), refetchInterval: 30_000 });

  async function prepare(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setError(null); setPrepared(null); setHashes([]);
    try {
      const token = await getAccessToken(); if (!token || !wallet) throw new Error("Your secure session expired.");
      const response = await fetch("/api/defi/aave/action", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, sender: wallet.address, symbol, amount }) });
      const body = await response.json() as Prepared & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "Aave could not simulate this action.");
      setPrepared(body);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Simulation failed."); }
    finally { setWorking(false); }
  }

  async function execute() {
    if (!prepared || !wallet || !market.data) return; setWorking(true); setError(null);
    let token: string | null = null; let intentId: string | undefined;
    try {
      token = await getAccessToken(); if (!token) throw new Error("Your secure session expired.");
      const intentResponse = await fetch("/api/intents/evaluate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: action, walletAddress: wallet.address, chainId: 8453, asset: symbol, amount, destination: market.data.market, estimatedUsd: symbol === "USDC" ? Number(amount) : undefined }) });
      const intent = await intentResponse.json() as { intentId?: string; message?: string; decision?: { requiresStepUp?: boolean } }; if (!intentResponse.ok || !intent.intentId) throw new Error(intent.message ?? "Policy review failed.");
      intentId = intent.intentId;
      if (intent.decision?.requiresStepUp && !mfaMethods.includes("passkey")) throw new Error("Set up a passkey in the Safety center before this higher-risk credit action.");
      const transactions = collectUnsignedTransactions(prepared.plan, HOME_CHAIN.id); if (!transactions.length) throw new Error("Aave returned no transaction to sign.");
      const submitted: string[] = []; const client = createPublicClient({ chain: HOME_CHAIN, transport: http() });
      for (const [index, transaction] of transactions.entries()) { const result = await sendTransaction(transaction, { address: wallet.address, uiOptions: { description: `${action === "borrow" ? "Borrow" : "Repay"} ${amount} ${symbol} through Aave on Base.`, buttonText: "Confirm with wallet", isCancellable: true } }); submitted.push(result.hash); if (index < transactions.length - 1) { const receipt = await client.waitForTransactionReceipt({ hash: result.hash, confirmations: 1, timeout: 120_000 }); if (receipt.status !== "success") throw new Error("A prerequisite transaction reverted. The next Aave transaction was not submitted."); } }
      setHashes(submitted);
      await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId, status: "submitted", transactionHash: submitted.at(-1) }) });
      void position.refetch();
    } catch (caught) {
      if (intentId && token) await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId, status: "cancelled" }) }).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : "The action was not submitted.");
    } finally { setWorking(false); }
  }

  const before = prepared ? findStringField(prepared.preview, ["healthFactorBefore"]) : findStringField(position.data, ["healthFactor"]);
  const after = prepared ? findStringField(prepared.preview, ["healthFactorAfter"]) : undefined;
  const warnings = prepared ? [...new Set(collectWarnings(prepared.preview))] : [];

  return <><div className="notice borrowNotice"><ShieldAlert size={18} /><span><strong>Borrow only against collateral you can afford to lose.</strong> Liquidation is automatic at the protocol level. Aurel cannot stop it or restore collateral.</span></div>
    <div className="contentGrid"><section className="panel widePanel"><div className="panelHeading"><div><p className="eyebrow">AAVE V3 · BASE</p><h2>Collateral and debt</h2></div><span className="statusBadge neutral">Live protocol view</span></div>
      <div className="borrowHealth"><div><span>Current health factor</span><strong>{before ?? "No active debt"}</strong><small>Below 1.00 is liquidatable</small></div><div><span>Protocol</span><strong>Aave V3</strong><small>Onchain and noncustodial</small></div><div><span>Position source</span><strong>{position.isPending ? "Reading…" : "Observed"}</strong><small>Refreshed from Aave</small></div></div>
      <button className="button primary" onClick={() => { setOpen(true); setPrepared(null); setError(null); setHashes([]); }}>Review a borrow or repayment <ArrowRight size={15} /></button>
    </section><aside className="panel connectionPanel"><p className="eyebrow">AVAILABLE MARKETS</p>{market.data?.reserves.map((reserve) => <div className="rateRow" key={reserve.symbol}><span><strong>{reserve.symbol}</strong><small>${(Number(reserve.availableLiquidity.usd) / 1_000_000).toFixed(1)}m liquidity</small></span><b>{reserve.borrowApyPct}%</b></div>)}<p className="riskFineprint">Rates are variable. Available liquidity and protocol parameters can change before execution.</p></aside></div>
    {open && <div className="modalBackdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section className="financialModal" role="dialog" aria-modal="true"><button className="modalClose" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button><form onSubmit={(event) => void prepare(event)}><p className="eyebrow">SIMULATE BEFORE SIGNING</p><h2>{action === "borrow" ? "Borrow" : "Repay"} on Base</h2><p>Aave simulates the resulting position before Aurel presents any transaction for signature.</p>
      <div className="segmentedControl"><button type="button" className={action === "borrow" ? "active" : ""} onClick={() => { setAction("borrow"); setPrepared(null); }}>Borrow</button><button type="button" className={action === "repay" ? "active" : ""} onClick={() => { setAction("repay"); setPrepared(null); }}>Repay</button></div>
      <label className="fieldLabel">Asset<select value={symbol} onChange={(event) => { setSymbol(event.target.value as "USDC" | "WETH"); setPrepared(null); }}><option>USDC</option><option>WETH</option></select></label><label className="fieldLabel">Amount<input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setPrepared(null); }} placeholder="0.00" /></label>
      {prepared && <><div className="transactionSummary"><span>Health before<strong>{before ?? "—"}</strong></span><span>Health after<strong>{after ?? "—"}</strong></span><span>Transactions<strong>{collectUnsignedTransactions(prepared.plan, 8453).length}</strong></span></div>{warnings.map((warning) => <div className="formWarning" key={warning}><AlertTriangle size={15} /> {warning}</div>)}</>}
      {error && <div className="formError" role="alert">{error}</div>}{hashes.map((hash) => <a key={hash} className="transactionSuccess" href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noreferrer"><Check size={15} /> Submitted <ExternalLink size={13} /></a>)}
      {!prepared ? <button className="button primary full" disabled={working || !amount}>{working ? <LoaderCircle className="spin" size={16} /> : null}Simulate position</button> : <button type="button" className="button primary full" disabled={working || Boolean(hashes.length)} onClick={() => void execute()}>{working ? <LoaderCircle className="spin" size={16} /> : <ShieldAlert size={16} />}Review and sign</button>}
    </form></section></div>}
  </>;
}
