"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, LoaderCircle, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { SUPPORTED_CHAINS } from "@/config/chains";
import { ApiError, useApi } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import type { AssetId, CatalogAsset } from "@/lib/swap/assets";
import { assetNetwork } from "@/lib/swap/picker-model";
import { displayRawAmount, formatEstimatedFeeUsd } from "@/lib/swap/review-model";
import { parseSwapDeepLink } from "@/lib/markets/swap-links";
import { SwapAssetPicker } from "./swap-asset-picker";
import { useToast } from "./toast";
import { TransactionProgress } from "./transaction-progress";

export type RouteQuote = {
  id: string; from: CatalogAsset; to: CatalogAsset; recipient: string; tool: string;
  fromAmountRaw: string; toAmountRaw: string; toAmountMinRaw: string; expiresAt: string;
  fromAmountUsd: string | null; toAmountUsd: string | null;
  networkFeeUsd: number | null; providerFeeUsd: number | null; priceImpactPercent: number | null;
};

function quoteErrorText(error: unknown): string {
  if (error instanceof ApiError && error.code === "feature_unavailable") return "Swaps aren't available right now.";
  if (error instanceof ApiError && error.code === "rate_limited") return "Too many quotes. Wait a minute and try again.";
  return error instanceof Error ? error.message : "We couldn't get a quote. Try again.";
}

function secondsLeft(expiresAt: string, now: number) {
  const expires = Date.parse(expiresAt);
  return Number.isFinite(expires) ? Math.max(0, Math.floor((expires - now) / 1000)) : 0;
}

export function SwapWorkspace() {
  const params = useSearchParams();
  const initial = useMemo(() => parseSwapDeepLink({ from: params.get("from"), to: params.get("to") }), [params]);
  const api = useApi();
  const swap = useAction({ label: "Swap" });
  const { address } = swap.wallet;
  const [fromAssetId, setFromAssetId] = useState<AssetId>(initial.fromAssetId);
  const [toAssetId, setToAssetId] = useState<AssetId>(initial.toAssetId);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [acknowledged, setAcknowledged] = useState(false);
  const [quote, setQuote] = useState<RouteQuote | null>(null);
  const [usedQuoteId, setUsedQuoteId] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);

  const readAsset = (id: AssetId) => api<{ asset: CatalogAsset }>(`/api/swap/assets?import=${encodeURIComponent(id)}`)
    .then((body) => body.asset, (reason) => { if (reason instanceof ApiError && reason.status === 404) return null; throw reason; });
  const fromAsset = useQuery({ queryKey: ["swap-asset", fromAssetId], queryFn: () => readAsset(fromAssetId), staleTime: 30_000 });
  const toAsset = useQuery({ queryKey: ["swap-asset", toAssetId], queryFn: () => readAsset(toAssetId), staleTime: 30_000 });
  const source = fromAsset.data;
  const destination = toAsset.data;
  const sourceChainId = SUPPORTED_CHAINS.find((chain) => chain.id === source?.chainId)?.id;
  const nativeBalance = useBalance({ address, chainId: sourceChainId,
    query: { enabled: Boolean(address && source && source.address === null) } });
  const tokenBalance = useReadContract({ address: source?.address as `0x${string}` | undefined,
    abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: sourceChainId,
    query: { enabled: Boolean(address && source?.address) } });
  const availableRaw = source?.address === null ? nativeBalance.data?.value : tokenBalance.data;
  const unverified = [source, destination].filter((asset): asset is CatalogAsset => Boolean(asset && asset.verification === "unverified"));
  const remaining = quote ? secondsLeft(quote.expiresAt, now) : 0;
  const inFlight = swap.phase !== "idle" || swap.outcomeUnknown;
  const crossChain = Boolean(quote && quote.from.chainId !== quote.to.chainId);

  function clearQuote() {
    setQuote(null); setError(null);
    // An uncertain outcome stays on screen until the customer checks Activity.
    if (!swap.outcomeUnknown && (swap.phase === "done" || swap.error)) swap.reset();
  }

  function reverse() {
    setFromAssetId(toAssetId); setToAssetId(fromAssetId); setAmount(""); setAcknowledged(false); clearQuote();
  }

  async function getQuote(event?: React.FormEvent) {
    event?.preventDefault();
    clearQuote();
    let requested = false;
    try {
      if (!source || !destination || !address) throw new Error("Choose two available assets.");
      if (source.id === destination.id) throw new Error("Choose two different assets.");
      if (unverified.length && !acknowledged) throw new Error("Confirm the unverified contract address first.");
      if (!/^\d+(?:\.\d+)?$/.test(amount) || (amount.split(".")[1]?.length ?? 0) > source.decimals || parseUnits(amount, source.decimals) <= 0n) throw new Error("Enter a valid amount.");
      setQuoting(true);
      requested = true;
      const query = new URLSearchParams({ from: source.id, to: destination.id, amount, slippageBps: String(slippageBps) });
      const body = await api<{ quote: RouteQuote }>(`/api/routes/quote?${query}`);
      setNow(Date.now());
      setQuote(body.quote);
    } catch (caught) {
      // Input problems stay next to the form; a failed quote request is an outcome.
      if (requested) toast.error("No quote", quoteErrorText(caught));
      else setError(quoteErrorText(caught));
    }
    finally { setQuoting(false); }
  }

  async function confirm() {
    if (!quote || remaining === 0 || usedQuoteId === quote.id) return;
    const { id } = quote;
    setUsedQuoteId(id);
    await swap.run({ kind: "route", quoteId: id });
  }

  const quoteUsed = Boolean(quote && usedQuoteId === quote.id);
  return <section className="panel swapPanel">
    <div className="panelHeading"><div><h2>Swap</h2><p>Exchange assets or move them to another network.</p></div></div>
    <form className="swapForm" onSubmit={(event) => void getQuote(event)}>
      <article className="swapAssetBlock"><div className="swapAssetLabel"><span>You pay</span><SwapAssetPicker value={fromAssetId} excludedId={toAssetId} label="You pay" onSelect={(id) => { setFromAssetId(id); setAcknowledged(false); clearQuote(); }} /></div>
        <input aria-label="Amount to swap" inputMode="decimal" value={amount} disabled={inFlight} onChange={(event) => { setAmount(event.target.value); clearQuote(); }} placeholder="0.00" />
        <div className="swapBalance">{availableRaw !== undefined && source ? `${formatUnits(availableRaw, source.decimals)} ${source.symbol} available` : nativeBalance.isPending || tokenBalance.isPending ? "Reading balance" : "Balance unavailable"}</div>
      </article>
      <button className="swapReverse" type="button" disabled={inFlight} onClick={reverse} aria-label="Reverse assets"><ArrowDownUp size={17} /></button>
      <article className="swapAssetBlock receive"><div className="swapAssetLabel"><span>You receive</span><SwapAssetPicker value={toAssetId} excludedId={fromAssetId} label="You receive" onSelect={(id) => { setToAssetId(id); setAcknowledged(false); clearQuote(); }} /></div>
        <strong>{quote ? displayRawAmount(quote.toAmountRaw, quote.to.decimals) : "—"}</strong>
        <small>{quote ? "Estimated" : "Choose an amount"}</small>
      </article>
      <button className="button primary full swapReviewButton" type="submit" disabled={quoting || inFlight || !address || !source || !destination}>
        {quoting ? <><LoaderCircle className="spin" size={16} /> Getting quote</> : !address ? "Preparing your wallet" : "Get quote"}
      </button>
    </form>
    <div className="swapSettings"><span>Max slippage</span><div>{[10, 50, 100].map((value) => <button type="button" key={value} disabled={inFlight} className={slippageBps === value ? "active" : ""} aria-pressed={slippageBps === value} onClick={() => { setSlippageBps(value); clearQuote(); }}>{value / 100}%</button>)}</div></div>
    {unverified.length > 0 && <label className="swapRiskCheck"><input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); clearQuote(); }} /><span>I checked the contract {unverified.length > 1 ? "addresses" : "address"} for {unverified.map((asset) => `${asset.symbol} on ${assetNetwork(asset.chainId)}`).join(" and ")}.</span></label>}
    {error && <p className="formError" role="alert">{error}</p>}
    {quote && <section className="swapQuotes" aria-label="Swap quote">
      <div className="swapQuotesHeader"><h3>Quote</h3><span>{remaining > 0 ? `Expires in ${remaining}s` : "Expired"}</span></div>
      <div className="swapReview">
        <span>You pay<strong>{displayRawAmount(quote.fromAmountRaw, quote.from.decimals)} {quote.from.symbol} on {assetNetwork(quote.from.chainId)}</strong></span>
        <span>You receive<strong>{displayRawAmount(quote.toAmountRaw, quote.to.decimals)} {quote.to.symbol} on {assetNetwork(quote.to.chainId)}</strong></span>
        <span>Minimum received<strong>{displayRawAmount(quote.toAmountMinRaw, quote.to.decimals)} {quote.to.symbol}</strong></span>
        <span>Network fee<strong>{formatEstimatedFeeUsd(quote.networkFeeUsd)}</strong></span>
        <span>Provider fee<strong>{formatEstimatedFeeUsd(quote.providerFeeUsd)}</strong></span>
        <span>Price impact<strong>{quote.priceImpactPercent === null ? "Unavailable" : `${quote.priceImpactPercent.toFixed(2)}%`}</strong></span>
        <span>Provider<strong>{quote.tool}</strong></span>
      </div>
      {crossChain && <p className="swapReviewStatus">Arrival on {assetNetwork(quote.to.chainId)} can take a few minutes.</p>}
      {swap.phase === "done"
        ? <button className="button primary full swapReviewAction" type="button" onClick={() => { swap.reset(); setQuote(null); setAmount(""); }}>New swap</button>
        : swap.phase !== "idle"
          ? <button className="button primary full swapReviewAction" type="button" disabled><LoaderCircle className="spin" size={16} /> {swap.phase === "preparing" ? "Checking" : swap.phase === "signing" ? "Confirm with your passkey" : "Swapping"}</button>
          : remaining === 0 || quoteUsed
            ? <button className="button secondary full swapReviewAction" type="button" disabled={quoting || swap.outcomeUnknown} onClick={() => void getQuote()}><RefreshCw size={16} /> {remaining === 0 ? "Quote expired. Refresh" : "Get a new quote"}</button>
            : <button className="button primary full swapReviewAction" type="button" onClick={() => void confirm()}>Swap</button>}
    </section>}
    <TransactionProgress label="Swap" phase={swap.phase} action={swap.action} outcomeUnknown={swap.outcomeUnknown} />
  </section>;
}
