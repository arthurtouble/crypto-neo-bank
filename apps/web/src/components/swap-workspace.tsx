"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, LoaderCircle, RefreshCw } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits } from "@/lib/format/units";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";
import { ApiError, useApi } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { useNativeBalance, useTokenBalance } from "@/lib/client/wallet-context";
import { formatToken, formatUsd, formatWeekdayTime, fromRaw } from "@/lib/format";
import { BASE_CHAIN_ID, registeredAsset } from "@/lib/assets/registry";
import { useOverview } from "@/lib/client/queries";
import Link from "next/link";
import type { AssetId, CatalogAsset } from "@/lib/swap/assets";
import { assetNetwork } from "@/lib/swap/picker-model";
import { costText, displayRawAmount, marketPriceText, rateText } from "@/lib/swap/review-model";
import { parseSwapDeepLink } from "@/lib/swap/links";
import { SwapAssetSelect } from "./swap-asset-select";
import { useToast } from "./toast";
import { TransactionProgress } from "./transaction-progress";
import { Notice } from "./states";

type SwapSwitches = { sameNetwork: boolean; otherNetwork: boolean };

export type RouteQuote = {
  id: string; from: CatalogAsset; to: CatalogAsset; recipient: string; tool: string;
  fromAmountRaw: string; toAmountRaw: string; toAmountMinRaw: string; expiresAt: string;
  fromAmountUsd: string | null; toAmountUsd: string | null;
  networkFeeUsd: number | null; providerFeeUsd: number | null; priceImpactPercent: number | null;
  /** Chainlink reference prices for stocks, gold, and the euro, with when they were published. */
  references?: Array<{ assetId: string; usd: string; observedAt: string }>;
};

/** A quote's price this far from the market price is worth a second look (closed or quiet markets). */
const REFERENCE_WARNING_PERCENT = 2;

function referenceTime(iso: string) {
  return formatWeekdayTime(iso);
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
  if (error instanceof ApiError && error.code === "provider_unavailable") return "Prices can't be loaded right now. Try again in a few minutes.";
  if (error instanceof ApiError && error.code === "balance_unavailable") return "Your balance can't be read right now. Try again in a minute.";
  return error instanceof Error ? error.message : "The quote can't be loaded right now. Try again.";
}

/** " on Ethereum" for an asset off the account's own network; nothing on Base. */
function onNetwork(chainId: number) { return chainId === BASE_CHAIN_ID ? "" : ` on ${assetNetwork(chainId)}`; }

/** Delivered somewhere the account doesn't hold (USDC on Arbitrum, say), so it won't show in Aura. Gold on Ethereum is held. */
function leavesAura(quote: RouteQuote) { return !registeredAsset(quote.to.id)?.uses.includes("hold"); }

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
  const overview = useOverview();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [quote]);

  const readAsset = (id: AssetId) => api<{ asset: CatalogAsset; switches?: SwapSwitches }>(`/api/swap/assets?import=${encodeURIComponent(id)}`)
    .catch((reason) => { if (reason instanceof ApiError && reason.status === 404) return null; throw reason; });
  const fromAsset = useQuery({ queryKey: ["swap-asset", fromAssetId], queryFn: () => readAsset(fromAssetId), staleTime: 30_000 });
  const toAsset = useQuery({ queryKey: ["swap-asset", toAssetId], queryFn: () => readAsset(toAssetId), staleTime: 30_000 });
  const source = fromAsset.data?.asset;
  const destination = toAsset.data?.asset;
  // The server checks the switches again on every quote and swap; this only says so before the customer types an amount.
  const switches = fromAsset.data?.switches ?? toAsset.data?.switches;
  const otherNetwork = Boolean(source && destination && source.chainId !== destination.chainId);
  const switchedOff = switches ? !(otherNetwork ? switches.otherNetwork : switches.sameNetwork) : false;
  const sourceChainId = SUPPORTED_CHAINS.find((chain) => chain.id === source?.chainId)?.id;
  const nativeBalance = useNativeBalance(address, sourceChainId, Boolean(source && source.address === null));
  const tokenBalance = useTokenBalance(source?.address as `0x${string}` | undefined, address, sourceChainId, Boolean(source?.address));
  const availableRaw = source?.address === null ? nativeBalance.data : tokenBalance.data;
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

  /** A new quote. Changing how far the price can move re-quotes in place: the old quote stays until the new one is in. */
  async function getQuote(event?: React.FormEvent, nextSlippageBps?: number) {
    event?.preventDefault();
    const requote = nextSlippageBps !== undefined;
    if (requote) setSlippageBps(nextSlippageBps); else clearQuote();
    let requested = false;
    try {
      if (!source || !destination || !address) throw new Error("Choose two available assets.");
      if (source.id === destination.id) throw new Error("Choose two different assets.");
      if (!/^\d+(?:\.\d+)?$/.test(amount) || (amount.split(".")[1]?.length ?? 0) > source.decimals || parseUnits(amount, source.decimals) <= 0n) throw new Error("Enter a valid amount.");
      if (availableRaw !== undefined && parseUnits(amount, source.decimals) > availableRaw)
        throw new Error(availableRaw === 0n ? `You don't have any ${source.symbol}.` : `You have ${formatUnits(availableRaw, source.decimals)} ${source.symbol}. Enter that or less.`);
      setQuoting(true);
      requested = true;
      const query = new URLSearchParams({ from: source.id, to: destination.id, amount, slippageBps: String(nextSlippageBps ?? slippageBps) });
      const body = await api<{ quote: RouteQuote }>(`/api/routes/quote?${query}`);
      setNow(Date.now());
      setQuote(body.quote);
    } catch (caught) {
      // Input problems stay next to the form; a failed quote request is an outcome.
      // Except not holding enough, which the customer fixes in the form.
      if (requote) setQuote(null);
      if (requested && !(caught instanceof ApiError && caught.code === "insufficient_balance")) toast.error("No quote", quoteErrorText(caught));
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
  const failed = swap.action?.status === "failed" || swap.action?.status === "expired";
  // An empty account has nothing to swap yet: point to Deposit rather than a form that can only say "you don't have any".
  const empty = Boolean(overview.data && !overview.isExample && overview.data.holdings.length > 0 && overview.data.holdings.every((item) => item.amountRaw === "0"));
  const showQuote = quote && !done;

  function chooseFrom(id: AssetId) { if (id === toAssetId) reverse(); else { setFromAssetId(id); clearQuote(); } }
  function chooseTo(id: AssetId) { if (id === fromAssetId) reverse(); else { setToAssetId(id); clearQuote(); } }
  function startOver() { const keep = failed; swap.reset(); setQuote(null); setError(null); if (!keep) setAmount(""); }

  return <div className="mxColumns">
    <div className="mxMain">
      <section className="mxPanel" aria-label="Swap form">
        <form className="mxForm mxSwapForm" onSubmit={(event) => void getQuote(event)}>
          {empty && <Notice>Your account is empty. <Link className="mxInlineLink" href="/app/deposit">Add money</Link> first, then swap.</Notice>}
          <div className="mxSwapSide">
            <div className="mxSwapSideHead"><span className="mxLabel">You pay</span><SwapAssetSelect value={fromAssetId} label="You pay" held disabled={inFlight} onSelect={chooseFrom} /></div>
            <div className="mxSwapAmountRow">
              <input className="mxSwapAmount" aria-label="Amount to swap" inputMode="decimal" autoComplete="off" value={amount} disabled={inFlight} onChange={(event) => { setAmount(event.target.value.trim()); clearQuote(); }} placeholder="0.00" />
              {/* Aura pays the network fee, so all of it can be swapped, ETH included. */}
              {source && availableRaw !== undefined && availableRaw > 0n && <button type="button" className="appButton mxMaxButton" disabled={inFlight}
                onClick={() => { setAmount(formatUnits(availableRaw, source.decimals)); clearQuote(); }}>Max</button>}
            </div>
            <span className="mxHint">{availableRaw !== undefined && source ? `${formatToken(fromRaw(availableRaw, source.decimals))} ${source.symbol} available` : nativeBalance.isPending || tokenBalance.isPending ? "Reading balance" : "Balance unavailable"}
              {showQuote && quote.fromAmountUsd ? ` · ${formatUsd(quote.fromAmountUsd)}` : ""}</span>
          </div>
          <button className="mxSwapReverse" type="button" disabled={inFlight} onClick={reverse} aria-label="Reverse assets"><ArrowDownUp aria-hidden="true" /></button>
          <div className="mxSwapSide mxSwapReceive">
            <div className="mxSwapSideHead"><span className="mxLabel">You receive</span><SwapAssetSelect value={toAssetId} label="You receive" disabled={inFlight} onSelect={chooseTo} /></div>
            <strong className="mxSwapAmount mxSwapEstimate">{showQuote ? displayRawAmount(quote.toAmountRaw, quote.to.decimals) : "—"}</strong>
            <span className="mxHint">{showQuote ? quote.toAmountUsd ? `About ${formatUsd(quote.toAmountUsd)}` : "Estimated" : "Enter an amount"}</span>
          </div>
          {switchedOff && <Notice tone="warning">{otherNetwork ? "Swaps to or from another network aren't available right now." : "Swaps aren't available right now."}</Notice>}
          {error && <p className="mxFieldError" role="alert">{error}</p>}
          {/* One primary action at a time: once there's a quote, its Swap button is it. */}
          {!showQuote && !done && <button className="appButton appButtonPrimary appButtonLarge" type="submit" disabled={quoting || inFlight || switchedOff || !address || !source || !destination}>
            {quoting ? <><LoaderCircle className="spin" aria-hidden="true" /> Getting quote</> : !address ? "Preparing your wallet" : "Get quote"}
          </button>}
        </form>
      </section>
    </div>
    <aside className="mxSide">
      {showQuote ? <section className="mxCard mxQuote" aria-label="Swap quote">
        <div className="mxQuoteHead"><h2>Quote</h2><span className={`mxBadge${remaining > 0 && remaining <= 10 ? " mxBadgeWarning" : ""}`}>{remaining > 0 ? `Expires in ${remaining}s` : "Expired"}</span></div>
        <dl className="mxSummary">
          <div><dt>You pay</dt><dd>{displayRawAmount(quote.fromAmountRaw, quote.from.decimals)} {quote.from.symbol}{onNetwork(quote.from.chainId)}</dd></div>
          <div><dt>You receive about</dt><dd>{displayRawAmount(quote.toAmountRaw, quote.to.decimals)} {quote.to.symbol}{onNetwork(quote.to.chainId)}</dd></div>
          <div><dt>You get at least</dt><dd>{displayRawAmount(quote.toAmountMinRaw, quote.to.decimals)} {quote.to.symbol}</dd></div>
          <div className="mxSwapPriceMove"><dt id="swap-slippage">Price can move up to</dt>
            <dd><div className="appSegmented" role="group" aria-labelledby="swap-slippage">{[10, 50, 100].map((value) => <button type="button" key={value}
              disabled={quoting || swap.phase !== "idle" || quoteUsed} aria-pressed={slippageBps === value}
              onClick={() => { if (value !== slippageBps) void getQuote(undefined, value); }}>{value / 100}%</button>)}</div></dd></div>
          <div><dt>Rate</dt><dd>{rateText(quote.from, quote.to, quote.fromAmountRaw, quote.toAmountRaw)}</dd></div>
          <div><dt>Network fee</dt><dd className="mxPositive">Paid by Aura</dd></div>
          <div><dt>Cost of this swap</dt><dd>{costText(quote)}</dd></div>
        </dl>
        {/* A same-network swap is one transaction: below the minimum, the chain undoes it. */}
        <p className="mxHint" data-testid="swap-price-move">The cost is already taken out of what you receive.
          {!crossChain && ` If the price moves more than ${slippageBps / 100}% before it goes through, the swap stops and your ${quote.from.symbol} stays in your account.`}</p>
        {(quote.references ?? []).map((reference) => {
          const asset = reference.assetId === quote.to.id ? quote.to : quote.from;
          const quoted = quotedPrice(quote, reference.assetId);
          const gap = quoted === null ? null : Math.abs(quoted - Number(reference.usd)) / Number(reference.usd) * 100;
          const far = gap !== null && gap > REFERENCE_WARNING_PERCENT;
          return <p className={`mxNote${far ? " mxNoteWarning" : ""}`} key={reference.assetId} data-testid="swap-reference">
            {marketPriceText(asset.symbol, reference.usd, referenceTime(reference.observedAt))}
            {far ? ` This quote is about ${gap.toFixed(1)}% away from it. The market may be closed or quiet, so check the amount.` : ""}
            {crossChain ? ` Arrival on ${assetNetwork(quote.to.chainId)} usually takes up to 30 minutes.` : ""}
          </p>;
        })}
        {/* Owner decision, 2 October 2026: keep receiving on other networks, and say plainly that it leaves Aura's view. */}
        {leavesAura(quote) && <Notice tone="warning" data-testid="swap-leaves-aura">This goes to your address on {assetNetwork(quote.to.chainId)}. Aura doesn&apos;t show balances there, and can&apos;t move it back for you. Use a wallet that supports {assetNetwork(quote.to.chainId)} to see or move it.</Notice>}
        {crossChain && !(quote.references ?? []).length && <Notice>Arrival on {assetNetwork(quote.to.chainId)} usually takes up to 30 minutes. You can leave this screen once it&apos;s sent.</Notice>}
        {swap.phase !== "idle"
          ? <button className="appButton appButtonPrimary appButtonLarge" type="button" disabled><LoaderCircle className="spin" aria-hidden="true" /> {swap.phase === "preparing" ? "Checking" : swap.phase === "signing" ? "Confirm with your passkey" : "Swapping"}</button>
          : remaining === 0 || quoteUsed
            ? <button className="appButton appButtonLarge" type="button" disabled={quoting || swap.outcomeUnknown} onClick={() => void getQuote()}><RefreshCw aria-hidden="true" /> {remaining === 0 ? "Quote expired. Refresh" : "Get a new quote"}</button>
            : quoting ? <button className="appButton appButtonPrimary appButtonLarge" type="button" disabled><LoaderCircle className="spin" aria-hidden="true" /> Getting quote</button>
              : <button className="appButton appButtonPrimary appButtonLarge" type="button" onClick={() => void confirm()}>Swap</button>}
      </section> : !done && <section className="mxCard mxQuoteEmpty">
        <h2>Quote</h2>
        <p className="mxHint">Choose what you pay and receive, and an amount. The quote shows what you get and what it costs before you swap.</p>
      </section>}
      <TransactionProgress label="Swap" phase={swap.phase} action={swap.action} outcomeUnknown={swap.outcomeUnknown} />
      {done && <button className="appButton appButtonPrimary appButtonLarge" type="button" onClick={startOver}>{failed ? "Try again" : "New swap"}</button>}
    </aside>
  </div>;
}
