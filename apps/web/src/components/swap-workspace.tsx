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
import { parseSwapDeepLink } from "@/lib/swap/links";
import { SwapAssetPicker } from "./swap-asset-picker";
import { useToast } from "./toast";
import { TransactionProgress } from "./transaction-progress";

export type RouteQuote = {
  id: string; from: CatalogAsset; to: CatalogAsset; recipient: string; tool: string;
  fromAmountRaw: string; toAmountRaw: string; toAmountMinRaw: string; expiresAt: string;
  fromAmountUsd: string | null; toAmountUsd: string | null;
  networkFeeUsd: number | null; providerFeeUsd: number | null; priceImpactPercent: number | null;
  /** Chainlink reference prices for stocks, gold, and the euro, with when they were published. */
  references?: Array<{ assetId: string; usd: string; observedAt: string }>;
};

/** A quote's price this far from the reference is worth a second look (thin markets, closed exchanges). */
const REFERENCE_WARNING_PERCENT = 2;

function referenceTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** The quote's price per token of a feed-priced asset, from LI.FI's dollar value of the other side. */
function quotedPrice(quote: RouteQuote, assetId: string): number | null {
  const tokens = (raw: string, decimals: number) => Number(formatUnits(BigInt(raw), decimals));
  if (assetId === quote.to.id && quote.fromAmountUsd) return Number(quote.fromAmountUsd) / tokens(quote.toAmountRaw, quote.to.decimals);
  if (assetId === quote.from.id && quote.toAmountUsd) return Number(quote.toAmountUsd) / tokens(quote.fromAmountRaw, quote.from.decimals);
  return null;
}

function quoteErrorText(error: unknown): string {
  if (error instanceof ApiError && error.code === "feature_unavailable") return "Swaps aren't available right now.";
  if (error instanceof ApiError && error.code === "rate_limited") return "Too many quotes. Wait a minute and try again.";
  if (error instanceof ApiError && error.code === "provider_unavailable") return "We can't get a price right now. Try again in a few minutes.";
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
  const remaining = quote ? secondsLeft(quote.expiresAt, now) : 0;
  // Once it has left the account, the swap is sent: the rest is tracked in Transactions, like Send.
  const handedOff = swap.action?.status === "settling";
  const inFlight = (swap.phase !== "idle" && swap.phase !== "done" && !handedOff) || swap.outcomeUnknown;
  const crossChain = Boolean(quote && quote.from.chainId !== quote.to.chainId);

  function clearQuote() {
    setQuote(null); setError(null);
    // An uncertain outcome stays on screen until the customer checks Activity.
    if (!swap.outcomeUnknown && (swap.phase === "done" || swap.error || handedOff)) swap.reset();
  }

  function reverse() {
    setFromAssetId(toAssetId); setToAssetId(fromAssetId); setAmount(""); clearQuote();
  }

  async function getQuote(event?: React.FormEvent) {
    event?.preventDefault();
    clearQuote();
    let requested = false;
    try {
      if (!source || !destination || !address) throw new Error("Choose two available assets.");
      if (source.id === destination.id) throw new Error("Choose two different assets.");
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
  const done = swap.phase === "done" || handedOff;
  return <div className="mxColumns">
    <div className="mxMain">
      <section className="mxPanel" aria-label="Swap form">
        <form className="mxForm mxSwapForm" onSubmit={(event) => void getQuote(event)}>
          <div className="mxSwapSide">
            <div className="mxSwapSideHead"><span className="mxLabel">You pay</span><SwapAssetPicker value={fromAssetId} excludedId={toAssetId} label="You pay" held onSelect={(id) => { setFromAssetId(id); clearQuote(); }} /></div>
            <input className="mxSwapAmount" aria-label="Amount to swap" inputMode="decimal" autoComplete="off" value={amount} disabled={inFlight} onChange={(event) => { setAmount(event.target.value); clearQuote(); }} placeholder="0.00" />
            <span className="mxHint">{availableRaw !== undefined && source ? `${formatUnits(availableRaw, source.decimals)} ${source.symbol} available` : nativeBalance.isPending || tokenBalance.isPending ? "Reading balance" : "Balance unavailable"}</span>
          </div>
          <button className="mxSwapReverse" type="button" disabled={inFlight} onClick={reverse} aria-label="Reverse assets"><ArrowDownUp aria-hidden="true" /></button>
          <div className="mxSwapSide mxSwapReceive">
            <div className="mxSwapSideHead"><span className="mxLabel">You receive</span><SwapAssetPicker value={toAssetId} excludedId={fromAssetId} label="You receive" onSelect={(id) => { setToAssetId(id); clearQuote(); }} /></div>
            <strong className="mxSwapAmount mxSwapEstimate">{quote ? displayRawAmount(quote.toAmountRaw, quote.to.decimals) : "—"}</strong>
            <span className="mxHint">{quote ? "Estimated" : "Choose an amount"}</span>
          </div>
          <div className="mxSwapSettings"><span className="mxLabel" id="swap-slippage">Max slippage</span>
            <div className="appSegmented" role="group" aria-labelledby="swap-slippage">{[10, 50, 100].map((value) => <button type="button" key={value} disabled={inFlight} aria-pressed={slippageBps === value} onClick={() => { setSlippageBps(value); clearQuote(); }}>{value / 100}%</button>)}</div></div>
          {error && <p className="mxFieldError" role="alert">{error}</p>}
          {/* One primary action at a time: once there's a quote, Swap is it. */}
          <button className={`appButton appButtonLarge${quote ? "" : " appButtonPrimary"}`} type="submit" disabled={quoting || inFlight || !address || !source || !destination}>
            {quoting ? <><LoaderCircle className="spin" aria-hidden="true" /> Getting quote</> : !address ? "Preparing your wallet" : "Get quote"}
          </button>
        </form>
      </section>
    </div>
    <aside className="mxSide">
      {quote ? <section className="mxCard mxQuote" aria-label="Swap quote">
        <div className="mxQuoteHead"><h2>Quote</h2><span className={`mxBadge${remaining > 0 && remaining <= 10 ? " mxBadgeWarning" : ""}`}>{remaining > 0 ? `Expires in ${remaining}s` : "Expired"}</span></div>
        <dl className="mxSummary">
          <div><dt>You pay</dt><dd>{displayRawAmount(quote.fromAmountRaw, quote.from.decimals)} {quote.from.symbol} on {assetNetwork(quote.from.chainId)}</dd></div>
          <div><dt>You receive</dt><dd>{displayRawAmount(quote.toAmountRaw, quote.to.decimals)} {quote.to.symbol} on {assetNetwork(quote.to.chainId)}</dd></div>
          <div><dt>Minimum received</dt><dd>{displayRawAmount(quote.toAmountMinRaw, quote.to.decimals)} {quote.to.symbol}</dd></div>
          <div><dt>Network fee on {assetNetwork(quote.from.chainId)}</dt><dd className="mxPositive">Paid by Aura</dd></div>
          <div><dt>{crossChain ? "Route fees" : "Provider fee"}</dt><dd>{crossChain && quote.fromAmountUsd && quote.toAmountUsd
            ? `About ${formatEstimatedFeeUsd(Math.max(0, Number(quote.fromAmountUsd) - Number(quote.toAmountUsd)))}, taken from the amount` : formatEstimatedFeeUsd(quote.providerFeeUsd)}</dd></div>
          <div><dt>Price impact</dt><dd>{quote.priceImpactPercent === null ? "Unavailable" : `${quote.priceImpactPercent.toFixed(2)}%`}</dd></div>
          <div><dt>Provider</dt><dd>{quote.tool}</dd></div>
        </dl>
        {(quote.references ?? []).map((reference) => {
          const asset = reference.assetId === quote.to.id ? quote.to : quote.from;
          const quoted = quotedPrice(quote, reference.assetId);
          const gap = quoted === null ? null : Math.abs(quoted - Number(reference.usd)) / Number(reference.usd) * 100;
          const far = gap !== null && gap > REFERENCE_WARNING_PERCENT;
          return <p className={`mxNote${far ? " mxNoteWarning" : ""}`} key={reference.assetId} data-testid="swap-reference">
            {asset.symbol} reference price ${Number(reference.usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}, as of {referenceTime(reference.observedAt)}.
            {far ? ` This quote is about ${gap.toFixed(1)}% away from it. Markets may be closed or thin, so check the amount.` : ""}
          </p>;
        })}
        {crossChain && <p className="mxNote">Arrival on {assetNetwork(quote.to.chainId)} usually takes up to 30 minutes. You can leave this screen once it&apos;s sent.</p>}
        {done
          ? <button className="appButton appButtonPrimary appButtonLarge" type="button" onClick={() => { swap.reset(); setQuote(null); setAmount(""); }}>New swap</button>
          : swap.phase !== "idle"
            ? <button className="appButton appButtonPrimary appButtonLarge" type="button" disabled><LoaderCircle className="spin" aria-hidden="true" /> {swap.phase === "preparing" ? "Checking" : swap.phase === "signing" ? "Confirm with your passkey" : "Swapping"}</button>
            : remaining === 0 || quoteUsed
              ? <button className="appButton appButtonLarge" type="button" disabled={quoting || swap.outcomeUnknown} onClick={() => void getQuote()}><RefreshCw aria-hidden="true" /> {remaining === 0 ? "Quote expired. Refresh" : "Get a new quote"}</button>
              : <button className="appButton appButtonPrimary appButtonLarge" type="button" onClick={() => void confirm()}>Swap</button>}
      </section> : <section className="mxCard mxQuoteEmpty">
        <h2>Quote</h2>
        <p className="mxHint">Choose what you pay and receive, and an amount. The quote shows what you get, the fees, and the price impact before you swap.</p>
      </section>}
      <TransactionProgress label="Swap" phase={swap.phase} action={swap.action} outcomeUnknown={swap.outcomeUnknown} />
    </aside>
  </div>;
}
