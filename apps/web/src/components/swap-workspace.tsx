"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, LoaderCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { SUPPORTED_CHAINS } from "@/config/chains";
import type { AssetId, CatalogAsset } from "@/lib/swap/assets";
import type { ValidatedSwapQuote } from "@/lib/swap/quotes";
import { assetNetwork } from "@/lib/swap/picker-model";
import { displayRawAmount, makeSwapReviewKey, quoteIsFresh } from "@/lib/swap/review-model";
import { parseSwapDeepLink } from "@/lib/markets/swap-links";
import { SwapAssetPicker } from "./swap-asset-picker";

type QuoteResponse = { quotes: ValidatedSwapQuote[]; observedAt: string; authority: string; error?: string; message?: string };

async function readAsset(id: AssetId, getAccessToken: () => Promise<string | null>): Promise<CatalogAsset | null> {
  const token = await getAccessToken();
  if (!token) throw new Error("Your secure session expired.");
  const response = await fetch(`/api/swap/assets?import=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Asset details are unavailable.");
  return (await response.json() as { asset: CatalogAsset }).asset;
}

export function SwapWorkspace() {
  const params = useSearchParams();
  const initial = useMemo(() => parseSwapDeepLink({ from: params.get("from"), to: params.get("to") }), [params]);
  const { getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const [fromAssetId, setFromAssetId] = useState<AssetId>(initial.fromAssetId);
  const [toAssetId, setToAssetId] = useState<AssetId>(initial.toAssetId);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<{ key: string; data: QuoteResponse } | null>(null);
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 5_000); return () => window.clearInterval(timer); }, []);

  const fromAsset = useQuery({ queryKey: ["swap-asset", fromAssetId], queryFn: () => readAsset(fromAssetId, getAccessToken), staleTime: 30_000 });
  const toAsset = useQuery({ queryKey: ["swap-asset", toAssetId], queryFn: () => readAsset(toAssetId, getAccessToken), staleTime: 30_000 });
  const source = fromAsset.data;
  const destination = toAsset.data;
  const address = wallet?.address as `0x${string}` | undefined;
  const sourceChainId = SUPPORTED_CHAINS.find((chain) => chain.id === source?.chainId)?.id;
  const nativeBalance = useBalance({ address, chainId: sourceChainId,
    query: { enabled: Boolean(address && source && source.address === null) } });
  const tokenBalance = useReadContract({ address: source?.address as `0x${string}` | undefined,
    abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: sourceChainId,
    query: { enabled: Boolean(address && source?.address) } });
  const availableRaw = source?.address === null ? nativeBalance.data?.value : tokenBalance.data;
  const reviewKey = makeSwapReviewKey({ fromAssetId, toAssetId, amount, walletAddress: address ?? "", slippageBps });
  const liveResult = result?.key === reviewKey ? result.data : null;
  const quote = liveResult?.quotes.find((item) => item.quoteId === selectedQuoteId) ?? liveResult?.quotes[0] ?? null;
  const freshQuote = quote && quoteIsFresh(quote.expiresAt, now) ? quote : null;
  const unverified = [source, destination].filter((asset): asset is CatalogAsset => Boolean(asset && asset.verification === "unverified"));

  function clearReview() { setResult(null); setSelectedQuoteId(null); setError(null); }

  function reverse() {
    setFromAssetId(toAssetId); setToAssetId(fromAssetId); setAmount(""); setAcknowledged(false); clearReview();
  }

  async function review(event: React.FormEvent) {
    event.preventDefault(); clearReview(); setWorking(true);
    try {
      if (!source || !destination || !address) throw new Error("Choose two available assets and connect your wallet.");
      if (source.id === destination.id) throw new Error("Choose two different assets.");
      if (unverified.length && !acknowledged) throw new Error("Confirm the unverified contract address first.");
      if (!/^\d+(?:\.\d+)?$/.test(amount) || (amount.split(".")[1]?.length ?? 0) > source.decimals || parseUnits(amount, source.decimals) <= 0n) throw new Error("Enter a valid amount.");
      const token = await getAccessToken();
      if (!token) throw new Error("Your secure session expired.");
      const requestKey = makeSwapReviewKey({ fromAssetId, toAssetId, amount, walletAddress: address, slippageBps });
      const response = await fetch("/api/swap/quote", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ fromAssetId, toAssetId, amount, fromAddress: address, slippageBps, unverifiedAcknowledgements: unverified.map((asset) => asset.id) }) });
      const body = await response.json() as QuoteResponse;
      if (!response.ok) throw new Error(body.message ?? "No live route is available right now.");
      if (!body.quotes.length) throw new Error("No live route is available right now.");
      setResult({ key: requestKey, data: body });
      setSelectedQuoteId(body.quotes[0].quoteId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Routes are unavailable. Try again."); }
    finally { setWorking(false); }
  }

  return <section className="panel swapPanel">
    <div className="panelHeading"><div><h2>Swap</h2><p>Choose what to exchange.</p></div></div>
    <form className="swapForm" onSubmit={(event) => void review(event)}>
      <article className="swapAssetBlock"><div className="swapAssetLabel"><span>You Pay</span><SwapAssetPicker value={fromAssetId} excludedId={toAssetId} label="You Pay" onSelect={(id) => { setFromAssetId(id); setAcknowledged(false); clearReview(); }} /></div>
        <input aria-label="Amount to swap" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); clearReview(); }} placeholder="0.00" />
        <div className="swapBalance">{availableRaw !== undefined && source ? `${formatUnits(availableRaw, source.decimals)} ${source.symbol} available` : nativeBalance.isPending || tokenBalance.isPending ? "Reading balance" : "Balance unavailable"}</div>
      </article>
      <button className="swapReverse" type="button" onClick={reverse} aria-label="Reverse assets"><ArrowDownUp size={17} /></button>
      <article className="swapAssetBlock receive"><div className="swapAssetLabel"><span>You Receive</span><SwapAssetPicker value={toAssetId} excludedId={fromAssetId} label="You Receive" onSelect={(id) => { setToAssetId(id); setAcknowledged(false); clearReview(); }} /></div>
        <strong>{freshQuote && destination ? displayRawAmount(freshQuote.toAmountMinRaw, destination.decimals) : "—"}</strong>
        <small>{freshQuote ? "Minimum received" : "Choose an amount"}</small>
      </article>
      <button className="button primary full swapReviewButton" type="submit" disabled={working || !source || !destination || !address}>{working ? <LoaderCircle className="spin" size={16} /> : null}{working ? "Finding Routes" : "Review Routes"}</button>
    </form>
    <div className="swapSettings"><span>Max Slippage</span><div>{[10, 50, 100].map((value) => <button type="button" key={value} className={slippageBps === value ? "active" : ""} aria-pressed={slippageBps === value} onClick={() => { setSlippageBps(value); clearReview(); }}>{value / 100}%</button>)}</div></div>
    {unverified.length > 0 && <label className="swapRiskCheck"><input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); clearReview(); }} /><span>I checked the contract {unverified.length > 1 ? "addresses" : "address"} for {unverified.map((asset) => `${asset.symbol} on ${assetNetwork(asset.chainId)}`).join(" and ")}.</span></label>}
    {error && <p className="formError" role="alert">{error}</p>}
    {liveResult && <section className="swapQuotes" aria-label="Available swap routes"><div className="swapQuotesHeader"><h3>Available Routes</h3><span>{liveResult.quotes.length} found</span></div>
      {liveResult.quotes.map((route) => <button type="button" className={`swapQuoteRow ${quote?.quoteId === route.quoteId ? "selected" : ""}`} key={route.planReference} onClick={() => setSelectedQuoteId(route.quoteId)}><span><strong>{route.provider.replace(/^lifi:/, "")}</strong><small>{route.routeKind === "cross_chain" ? "Across networks" : "Same network"}</small></span><span><strong>{destination ? displayRawAmount(route.toAmountMinRaw, destination.decimals) : "—"} {destination?.symbol}</strong><small>{route.totalFeeUsd === null ? "Total fees unavailable" : `≈ $${route.totalFeeUsd.toFixed(2)} estimated fees`}</small></span></button>)}
      {freshQuote && <div className="swapReview"><span>You Pay<strong>{amount} {source?.symbol}</strong></span><span>Minimum Received<strong>{destination ? displayRawAmount(freshQuote.toAmountMinRaw, destination.decimals) : "—"} {destination?.symbol}</strong></span><span>Estimated Fees<strong>{freshQuote.totalFeeUsd === null ? "Unavailable" : `≈ $${freshQuote.totalFeeUsd.toFixed(2)}`}</strong></span><span>Price Impact<strong>{freshQuote.priceImpactPercent === null ? "Unavailable" : `${freshQuote.priceImpactPercent.toFixed(2)}%`}</strong></span></div>}
      {quote && !freshQuote && <p className="formWarning">This quote expired. Review routes again.</p>}
      <p className="swapExecutionGate">Trading is unavailable until the route can be independently verified. No wallet approval will be requested.</p>
    </section>}
  </section>;
}
