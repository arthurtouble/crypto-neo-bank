"use client";

import { useMfa, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { ArrowDownUp, Check, LoaderCircle, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, getAddress, http, parseUnits } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { HOME_CHAIN } from "@/config/chains";
import { NATIVE_ASSET_ADDRESS, SWAP_ASSETS, type SwapAssetId } from "@/config/swap-assets";
import type { TransactionLifecycleStatus } from "@/lib/transactions/lifecycle";
import { TransactionProgress } from "./transaction-progress";

type SwapQuote = {
  quoteId: string;
  provider: string;
  providerName: string;
  fromAssetId: SwapAssetId;
  toAssetId: SwapAssetId;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  fromAmountUsd?: number;
  toAmountUsd?: number;
  valueDifferencePercent?: number;
  networkFeeUsd: number;
  approvalAddress?: string;
  transactionRequest: { to: string; data: string; value: string; chainId?: number };
};
type QuoteResponse = { quotes: SwapQuote[]; observedAt: string; expiresAt: string; comparedProviders: number };

const assets = Object.values(SWAP_ASSETS);
const compact = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 });
const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export function SwapWorkspace() {
  const { wallets } = useWallets();
  const { getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const { mfaMethods } = useMfa();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const [fromAssetId, setFromAssetId] = useState<SwapAssetId>("USDC");
  const [toAssetId, setToAssetId] = useState<SwapAssetId>("ETH");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [result, setResult] = useState<QuoteResponse | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<TransactionLifecycleStatus | null>(null);
  const selected = result?.quotes.find((item) => item.quoteId === selectedQuoteId) ?? result?.quotes[0] ?? null;
  const fromAsset = SWAP_ASSETS[fromAssetId];
  const toAsset = SWAP_ASSETS[toAssetId];
  const walletAddress = wallet?.address as `0x${string}` | undefined;
  const nativeBalance = useBalance({ address: walletAddress, chainId: HOME_CHAIN.id, query: { enabled: Boolean(walletAddress && fromAsset.address === NATIVE_ASSET_ADDRESS) } });
  const tokenBalance = useReadContract({ address: fromAsset.address === NATIVE_ASSET_ADDRESS ? undefined : getAddress(fromAsset.address), abi: erc20Abi, functionName: "balanceOf", args: walletAddress ? [walletAddress] : undefined, chainId: HOME_CHAIN.id, query: { enabled: Boolean(walletAddress && fromAsset.address !== NATIVE_ASSET_ADDRESS) } });
  const availableRaw = fromAsset.address === NATIVE_ASSET_ADDRESS ? nativeBalance.data?.value : tokenBalance.data;
  const available = availableRaw === undefined ? null : formatUnits(availableRaw, fromAsset.decimals);

  function resetQuote() {
    setResult(null); setSelectedQuoteId(null); setHash(null); setIntentId(null); setFlowStatus(null); setError(null);
  }

  function reverse() {
    const previousFrom = fromAssetId;
    setFromAssetId(toAssetId);
    setToAssetId(previousFrom);
    setAmount("");
    resetQuote();
  }

  async function balanceOf(assetId: SwapAssetId) {
    if (!wallet) return 0n;
    const client = createPublicClient({ chain: HOME_CHAIN, transport: http() });
    const asset = SWAP_ASSETS[assetId];
    if (asset.address === NATIVE_ASSET_ADDRESS) return client.getBalance({ address: getAddress(wallet.address) });
    return client.readContract({ address: getAddress(asset.address), abi: erc20Abi, functionName: "balanceOf", args: [getAddress(wallet.address)] });
  }

  async function review(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setStage("Comparing live quotes"); resetQuote();
    try {
      const token = await getAccessToken();
      if (!token || !wallet) throw new Error("Your secure session expired.");
      const raw = parseUnits(amount, fromAsset.decimals);
      if (raw <= 0n) throw new Error("Enter an amount greater than zero.");
      if (await balanceOf(fromAssetId) < raw) throw new Error(`You do not have enough ${fromAsset.symbol}.`);
      const response = await fetch("/api/swap/quote", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fromAssetId, toAssetId, amount, fromAddress: wallet.address, slippageBps }) });
      const body = await response.json() as QuoteResponse & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "No live quote is currently available.");
      setResult(body); setSelectedQuoteId(body.quotes[0]?.quoteId ?? null); setStage(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No live quote is currently available."); setStage(null); }
    finally { setWorking(false); }
  }

  async function execute() {
    if (!selected || !result || !wallet) return;
    setWorking(true); setError(null); setHash(null); setIntentId(null); setFlowStatus("reviewing");
    let token: string | null = null; let pendingIntent: string | undefined;
    try {
      token = await getAccessToken();
      if (!token) throw new Error("Your secure session expired.");
      if (Date.now() >= new Date(result.expiresAt).getTime()) { setResult(null); throw new Error("This quote expired. Review fresh quotes before continuing."); }
      const raw = parseUnits(amount, fromAsset.decimals);
      if (await balanceOf(fromAssetId) < raw) throw new Error(`Your ${fromAsset.symbol} balance changed. Review the swap again.`);
      const client = createPublicClient({ chain: HOME_CHAIN, transport: http() });
      if (fromAsset.address !== NATIVE_ASSET_ADDRESS && selected.approvalAddress) {
        const approvalTarget = getAddress(selected.approvalAddress);
        const allowance = await client.readContract({ address: getAddress(fromAsset.address), abi: erc20Abi, functionName: "allowance", args: [getAddress(wallet.address), approvalTarget] });
        if (allowance < raw) {
          setStage("Review the approval"); setFlowStatus("awaiting_confirmation");
          const approval = await sendTransaction({ to: getAddress(fromAsset.address), chainId: HOME_CHAIN.id, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approvalTarget, raw] }) }, { address: wallet.address, uiOptions: { description: `Approve exactly ${amount} ${fromAsset.symbol} for this swap.`, buttonText: "Approve swap", isCancellable: true } });
          setStage("Confirming approval"); setFlowStatus("reviewing");
          const receipt = await client.waitForTransactionReceipt({ hash: approval.hash, confirmations: 1, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error("The approval did not complete. No swap was submitted.");
        }
      }
      setStage("Running safety checks");
      const intentResponse = await fetch("/api/intents/evaluate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "swap", walletAddress: wallet.address, chainId: HOME_CHAIN.id, asset: fromAsset.symbol, amount, destination: selected.transactionRequest.to, estimatedUsd: selected.fromAmountUsd }) });
      const intent = await intentResponse.json() as { intentId?: string; message?: string; decision?: { requiresStepUp?: boolean; findings?: Array<{ level: string; message: string }> } };
      if (!intentResponse.ok || !intent.intentId) throw new Error(intent.decision?.findings?.find((item) => item.level === "block")?.message ?? intent.message ?? "The swap did not pass safety review.");
      pendingIntent = intent.intentId; setIntentId(intent.intentId);
      if (intent.decision?.requiresStepUp && !mfaMethods.includes("passkey")) throw new Error("Set up a passkey in Security before this swap.");
      setStage("Confirm in your wallet"); setFlowStatus("awaiting_confirmation");
      const transaction = selected.transactionRequest;
      await client.call({ account: getAddress(wallet.address), to: getAddress(transaction.to), data: transaction.data as `0x${string}`, value: BigInt(transaction.value || "0") });
      const submitted = await sendTransaction({ to: getAddress(transaction.to), data: transaction.data as `0x${string}`, value: BigInt(transaction.value || "0"), chainId: HOME_CHAIN.id }, { address: wallet.address, uiOptions: { description: `Swap ${amount} ${fromAsset.symbol} for at least ${compact.format(Number(selected.toAmountMin))} ${toAsset.symbol}.`, buttonText: "Confirm swap", isCancellable: true } });
      setHash(submitted.hash); setStage(null); setFlowStatus("submitted");
      await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId: intent.intentId, status: "submitted", transactionHash: submitted.hash, routeReference: selected.quoteId }) });
    } catch (caught) {
      if (pendingIntent && token) await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId: pendingIntent, status: "cancelled" }) }).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : "The swap was not submitted."); setStage(null); setFlowStatus("failed");
    } finally { setWorking(false); }
  }

  return <section className="panel swapPanel">
    <div className="panelHeading"><div><h2>Swap Assets</h2><p>Compare live prices and choose a route.</p></div><span className="statusBadge good">Live Quotes</span></div>
    <form className="swapForm" onSubmit={(event) => void review(event)}>
      <article className="swapAssetBlock"><label>You Pay<select value={fromAssetId} onChange={(event) => { const next = event.target.value as SwapAssetId; setFromAssetId(next); if (next === toAssetId) setToAssetId(fromAssetId); resetQuote(); }}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label><input aria-label="Amount to swap" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); resetQuote(); }} placeholder="0.00" /><div className="swapBalance"><span>{available === null ? "Reading balance" : `${compact.format(Number(available))} ${fromAsset.symbol} available`}</span>{available !== null && fromAsset.address !== NATIVE_ASSET_ADDRESS && <button type="button" onClick={() => { setAmount(available); resetQuote(); }}>Max</button>}</div></article>
      <button className="swapReverse" type="button" onClick={reverse} aria-label="Reverse assets"><ArrowDownUp size={17} /></button>
      <article className="swapAssetBlock receive"><label>You Receive<select value={toAssetId} onChange={(event) => { const next = event.target.value as SwapAssetId; setToAssetId(next); if (next === fromAssetId) setFromAssetId(toAssetId); resetQuote(); }}>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.symbol} · {asset.name}</option>)}</select></label><strong>{selected ? compact.format(Number(selected.toAmountMin)) : "—"}</strong><small>{selected ? "Minimum received" : toAsset.name}</small></article>
      <button className="button secondary full" disabled={working || !amount}>{working && !result ? <LoaderCircle className="spin" size={15} /> : null}{working && !result ? stage : "Review Quotes"}</button>
    </form>
    <div className="swapSettings"><span>Max Slippage</span><div>{[10, 50, 100].map((value) => <button type="button" key={value} className={slippageBps === value ? "active" : ""} aria-pressed={slippageBps === value} onClick={() => { setSlippageBps(value); resetQuote(); }}>{value / 100}%</button>)}</div></div>
    {result && <section className="swapQuotes" aria-label="Available swap quotes"><div className="swapQuotesHeader"><h3>Available Quotes</h3><span>{result.quotes.length} of {result.comparedProviders} available</span></div>{result.quotes.map((quote, index) => <button type="button" className={`swapQuoteRow ${selected?.quoteId === quote.quoteId ? "selected" : ""}`} key={quote.quoteId} onClick={() => setSelectedQuoteId(quote.quoteId)}><span className="swapQuoteCheck">{selected?.quoteId === quote.quoteId ? <Check size={14} /> : null}</span><span><strong>{quote.providerName}</strong><small>{index === 0 ? "Best value" : "Live route"}</small></span><span><strong>{compact.format(Number(quote.toAmountMin))} {toAsset.symbol}</strong><small>{quote.networkFeeUsd > 0 ? `${money.format(quote.networkFeeUsd)} estimated network fee` : "Network fee unavailable"}</small></span></button>)}<div className="swapReview"><span>You Pay<strong>{amount} {fromAsset.symbol}</strong></span><span>Minimum Received<strong>{compact.format(Number(selected?.toAmountMin ?? 0))} {toAsset.symbol}</strong></span><span>Value Difference<strong>{selected?.valueDifferencePercent == null ? "Unavailable" : `${selected.valueDifferencePercent.toFixed(2)}%`}</strong></span></div><button className="button primary full" disabled={working || Boolean(hash)} onClick={() => void execute()}>{working ? <LoaderCircle className="spin" size={15} /> : null}{working ? stage : "Confirm Swap"}</button></section>}
    {flowStatus && <TransactionProgress action="Swap" status={flowStatus} stage={stage} error={error} intentId={intentId} hashes={hash ? [hash] : []} chainId={HOME_CHAIN.id} submittedDetail="Your portfolio will update after the swap settles." />}
    {!flowStatus && error && <div className="formError" role="alert"><ShieldAlert size={15} /> {error}</div>}
    <p className="authorityFootnote">Quotes expire quickly. You review the route and approve every transaction before assets move.</p>
  </section>;
}
