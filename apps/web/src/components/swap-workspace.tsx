"use client";

import { useConnectWallet, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, LoaderCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBalance, useReadContract } from "wagmi";
import { erc20Abi, formatUnits, getAddress, parseUnits } from "viem";
import { SUPPORTED_CHAINS } from "@/config/chains";
import type { AssetId, CatalogAsset } from "@/lib/swap/assets";
import type { ValidatedSwapQuote } from "@/lib/swap/quotes";
import { assetNetwork } from "@/lib/swap/picker-model";
import { displayRawAmount, formatEstimatedFeeUsd, makeSwapReviewKey, quoteIsFresh } from "@/lib/swap/review-model";
import { parseSwapDeepLink } from "@/lib/markets/swap-links";
import { normalizePreparedCall, type PreparedCallInput } from "@/lib/transactions/evidence";
import { SwapAssetPicker } from "./swap-asset-picker";
import { TransactionProgress } from "./transaction-progress";
import { SwapReminderPanel } from "./swap-reminder-panel";
import { PriceAlertPanel } from "./price-alert-panel";

type SwapQuote = ValidatedSwapQuote & { planId?: string };
type QuoteResponse = { quotes: SwapQuote[]; observedAt: string; authority: string; error?: string; message?: string };
type ReviewState = "idle" | "reviewed" | "prepared" | "approval_required" | "submitted";
type PreparedSwap = { state: "prepared"; intentId: string; stepIndex: number; fingerprint: string; call: PreparedCallInput; expiresAt: string };
type PreparedApproval = { state: "approval_required"; approvalId: string; kind: "approve" | "reset_required";
  amountRaw: string; spender: string; fingerprint: string; call: PreparedCallInput; expiresAt: string };
type SwapPreparation = PreparedSwap | PreparedApproval;

export function SwapRouteReview({ planId, fresh, walletAddress, busy, state, routeKind, onReview, onSubmit, onApprove, approvalKind, approvalAmount }: {
  planId: string | null; fresh: boolean; walletAddress: string | null; busy: boolean;
  state: ReviewState; routeKind?: "same_chain" | "cross_chain"; onReview(): void; onSubmit?(): void;
  onApprove?(): void; approvalKind?: "approve" | "reset_required"; approvalAmount?: string;
}) {
  if (state === "submitted") return null;
  if (!fresh) return <p className="swapReviewStatus">This quote expired. Find a new route.</p>;
  if (state === "approval_required" && onApprove) return <div><p className="swapReviewStatus" role="status"><strong>{approvalKind === "reset_required" ? "Reset Token Approval" : "Token Approval Required"}</strong><span>{approvalKind === "reset_required" ? "Reset the old allowance before approving a new amount." : `Approve ${approvalAmount ?? "the exact amount"} for this swap.`} This does not submit a swap. Approvals remain on chain until used or revoked.</span></p><button className="button primary full swapReviewAction" type="button" disabled={busy} onClick={onApprove}>{busy ? "Opening Wallet" : approvalKind === "reset_required" ? "Reset Approval" : "Approve Token"}</button></div>;
  if (state === "prepared") return <div><p className="swapReviewStatus" role="status"><strong>Route Verified</strong><span>No swap has been submitted.{routeKind === "cross_chain" ? " Arrival on the other network may take a few minutes." : ""}</span></p>{onSubmit && <button className="button primary full swapReviewAction" type="button" disabled={busy} onClick={onSubmit}>{busy ? "Opening Wallet" : "Confirm Swap"}</button>}</div>;
  if (state === "approval_required") return <p className="swapReviewStatus" role="status"><strong>Token Approval Required</strong><span>No swap has been submitted. Find a new route to continue.</span></p>;
  if (state === "reviewed") return <p className="swapReviewStatus" role="status"><strong>Review Complete</strong><span>No swap has been submitted.</span></p>;
  if (!planId) return <p className="swapReviewStatus">This route cannot be reviewed right now.</p>;
  if (!walletAddress) return <p className="swapReviewStatus">Connect a wallet to review this route.</p>;
  return <button className="button primary full swapReviewAction" type="button" disabled={busy} onClick={onReview}>
    {busy ? <><LoaderCircle className="spin" size={16} /> Checking Route</> : "Review Swap"}
  </button>;
}

function reviewError(code: string | undefined): string {
  switch (code) {
    case "route_unavailable": case "quote_mismatch": case "asset_unavailable": return "This route isn't available to trade. Try another pair or refresh the quote.";
    case "quote_expired": case "quote_conflict": case "prepare_conflict": case "review_mismatch": return "This quote expired. Find a new route.";
    case "approval_required": return "This route needs a token approval before you can swap.";
    case "valuation_unavailable": case "spent_value_unavailable": return "We can't check this swap safely right now. Try again later.";
    case "policy_not_permitted": case "review_period_required": case "step_up_unavailable": return "This swap can't be reviewed with your current transaction settings.";
    case "wallet_not_linked": return "Connect a wallet linked to your account.";
    case "feature_unavailable": case "access_unavailable": return "Swaps aren't available for this account yet.";
    default: return "We couldn't review this route. Try again.";
  }
}

export function swapQuoteErrorText(code: string | undefined): string {
  switch (code) {
    case "no_live_route": return "No route is available for this pair right now. Try another amount or asset.";
    case "quote_unavailable": return "Routes are temporarily unavailable. Try again shortly.";
    case "unsupported_chain": return "This asset pair cannot be swapped right now.";
    case "asset_unavailable": return "This asset or amount is not available for swapping right now.";
    case "feature_unavailable": case "access_unavailable": return "Swaps aren't available for this account yet.";
    default: return "We couldn't find a route. Try again.";
  }
}

export async function requestSwapRouteReview(input: { token: string; planId: string; walletAddress: string }, onPolicyReviewed?: () => void): Promise<SwapPreparation> {
  const headers = { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" };
  const response = await fetch("/api/swap/review", { method: "POST", headers, cache: "no-store",
    body: JSON.stringify({ planId: input.planId, walletAddress: input.walletAddress }) });
  const review = await response.json() as { error?: string; intentId?: string };
  if (!response.ok || !review.intentId) throw new Error(reviewError(review.error));
  const prepared = await fetch("/api/swap/prepare", { method: "POST", headers, cache: "no-store",
    body: JSON.stringify({ intentId: review.intentId, planId: input.planId, walletAddress: input.walletAddress }) });
  const body = await prepared.json() as Partial<PreparedSwap> & { error?: string };
  if (prepared.status === 409 && body.error === "approval_required") {
    const approval = await fetch("/api/swap/approval", { method: "POST", headers, cache: "no-store",
      body: JSON.stringify({ intentId: review.intentId, planId: input.planId, walletAddress: input.walletAddress }) });
    const prerequisite = await approval.json() as Partial<PreparedApproval> & { error?: string };
    if (approval.status !== 201 || !prerequisite.approvalId || !prerequisite.call || !prerequisite.fingerprint
      || !prerequisite.expiresAt || !prerequisite.spender || !prerequisite.amountRaw
      || !["approve", "reset_required"].includes(prerequisite.kind ?? "")) throw new Error(reviewError(prerequisite.error));
    onPolicyReviewed?.();
    return { state: "approval_required", approvalId: prerequisite.approvalId,
      kind: prerequisite.kind!, amountRaw: prerequisite.amountRaw, spender: prerequisite.spender,
      fingerprint: prerequisite.fingerprint, call: prerequisite.call, expiresAt: prerequisite.expiresAt };
  }
  if (prepared.status !== 201 || body.intentId !== review.intentId || body.stepIndex !== 0 || !body.call || !body.fingerprint || !body.expiresAt) throw new Error(reviewError(body.error));
  onPolicyReviewed?.();
  return { state: "prepared", intentId: body.intentId, stepIndex: 0, call: body.call, fingerprint: body.fingerprint, expiresAt: body.expiresAt };
}

export async function submitPreparedApproval(input: {
  prepared: PreparedApproval; walletAddress: string; token: string;
  send: (call: { chainId: number; to: `0x${string}`; value: bigint; data: `0x${string}` }) => Promise<{ hash: string }>;
  onBroadcast?: (hash: string) => void;
}): Promise<{ hash: string; reportRecorded: boolean }> {
  const { prepared } = input;
  if (!quoteIsFresh(prepared.expiresAt) || prepared.call.chainId !== 8453
    || getAddress(prepared.call.from) !== getAddress(input.walletAddress)
    || prepared.call.value !== "0") throw new Error("This approval expired. Find a new route.");
  const call = await normalizePreparedCall(prepared.call);
  if (call.fingerprint !== prepared.fingerprint) throw new Error("This approval changed. Find a new route.");
  const sent = await input.send({ chainId: call.chainId, to: call.to, value: 0n, data: call.data });
  input.onBroadcast?.(sent.hash);
  let reportRecorded = false;
  try {
    const response = await fetch("/api/swap/approval", { method: "PATCH", cache: "no-store",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: prepared.approvalId, transactionHash: sent.hash }) });
    reportRecorded = response.ok;
  } catch { /* An approval may be on chain even if reporting failed. */ }
  return { hash: sent.hash, reportRecorded };
}

export async function submitPreparedSwap(input: {
  prepared: PreparedSwap; walletAddress: string; reviewKey: string; currentReviewKey: string; token: string;
  send: (call: { chainId: number; to: `0x${string}`; value: bigint; data: `0x${string}` }) => Promise<{ hash: string }>;
  onBroadcast?: (hash: string) => void;
}): Promise<{ hash: string; reportRecorded: boolean }> {
  const { prepared } = input;
  if (prepared.state !== "prepared" || prepared.stepIndex !== 0 || input.reviewKey !== input.currentReviewKey
    || !quoteIsFresh(prepared.expiresAt) || prepared.call.chainId !== 8453
    || getAddress(prepared.call.from) !== getAddress(input.walletAddress)) throw new Error("This swap changed. Find a new route before continuing.");
  const call = await normalizePreparedCall(prepared.call);
  if (call.fingerprint !== prepared.fingerprint) throw new Error("This swap changed. Find a new route before continuing.");
  const sent = await input.send({ chainId: call.chainId, to: call.to, value: BigInt(call.value), data: call.data });
  input.onBroadcast?.(sent.hash);
  let reportRecorded = false;
  try {
    const response = await fetch("/api/intents/status", { method: "POST", cache: "no-store",
      headers: { Authorization: `Bearer ${input.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ intentId: prepared.intentId, stepIndex: prepared.stepIndex, status: "submitted", transactionHash: sent.hash }) });
    reportRecorded = response.ok;
  } catch { /* A broadcast transaction remains pending even when reporting fails. */ }
  return { hash: sent.hash, reportRecorded };
}

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
  const { connectWallet } = useConnectWallet();
  const { sendTransaction } = useSendTransaction();
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
  const [reviewing, setReviewing] = useState(false);
  const [reviewState, setReviewState] = useState<ReviewState>("idle");
  const [reviewErrorText, setReviewErrorText] = useState<string | null>(null);
  const [preparedSwap, setPreparedSwap] = useState<{ key: string; planId: string; result: PreparedSwap } | null>(null);
  const [preparedApproval, setPreparedApproval] = useState<PreparedApproval | null>(null);
  const [approvalHash, setApprovalHash] = useState<string | null>(null);
  const [approvalTrackingId, setApprovalTrackingId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const [approvalUncertain, setApprovalUncertain] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submittedHash, setSubmittedHash] = useState<string | null>(null);
  const [submittedIntentId, setSubmittedIntentId] = useState<string | null>(null);
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  const [reportWarning, setReportWarning] = useState<string | null>(null);
  const reviewVersion = useRef(0);
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

  function clearReview() { reviewVersion.current += 1; setResult(null); setSelectedQuoteId(null); setError(null); setReviewState("idle"); setReviewErrorText(null); setPreparedSwap(null); setPreparedApproval(null); setSubmissionUncertain(false);
    if (["confirmed", "failed", "inconsistent"].includes(approvalStatus ?? "")) { setApprovalHash(null); setApprovalTrackingId(null); setApprovalStatus(null); setApprovalUncertain(false); }
  }

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
      if (!response.ok) throw new Error(swapQuoteErrorText(body.error));
      if (!body.quotes.length) throw new Error(swapQuoteErrorText("no_live_route"));
      setResult({ key: requestKey, data: body });
      setSelectedQuoteId(body.quotes[0].quoteId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Routes are unavailable. Try again."); }
    finally { setWorking(false); }
  }

  async function reviewSelectedRoute() {
    if (!freshQuote?.planId || !address || reviewing) return;
    const planId = freshQuote.planId;
    const version = reviewVersion.current;
    const expiresAt = freshQuote.expiresAt;
    setReviewErrorText(null); setReviewing(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your secure session expired.");
      const state = await requestSwapRouteReview({ token, planId, walletAddress: address }, () => {
        if (reviewVersion.current === version && quoteIsFresh(expiresAt)) setReviewState("reviewed");
      });
      if (reviewVersion.current !== version || !quoteIsFresh(expiresAt)) return;
      setReviewState(state.state);
      if (state.state === "prepared") setPreparedSwap({ key: reviewKey, planId, result: state });
      if (state.state === "approval_required") setPreparedApproval(state);
    } catch (caught) { if (reviewVersion.current === version) { setReviewState("idle"); setReviewErrorText(caught instanceof Error ? caught.message : "We couldn't review this route. Try again."); } }
    finally { setReviewing(false); }
  }

  async function confirmApproval() {
    if (!preparedApproval || !address || approving || approvalUncertain || approvalHash) return;
    setReviewErrorText(null); setApproving(true);
    let broadcasted = false;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your secure session expired. Sign in again before approving.");
      const result = await submitPreparedApproval({ prepared: preparedApproval, walletAddress: address, token,
        send: (transaction) => sendTransaction(transaction, { address,
          uiOptions: { description: preparedApproval.kind === "reset_required"
            ? `Reset your existing ${source?.symbol ?? "token"} approval. This does not submit a swap.`
            : `Approve exactly ${amount} ${source?.symbol ?? "tokens"} for this swap. This does not submit the swap.`,
          buttonText: preparedApproval.kind === "reset_required" ? "Reset approval" : "Approve token",
          successHeader: "Approval submitted", isCancellable: true } }),
        onBroadcast: (hash) => { broadcasted = true; setApprovalHash(hash); setApprovalTrackingId(preparedApproval.approvalId); setApprovalStatus("pending"); }
      });
      if (!result.reportRecorded) setReviewErrorText("The approval was broadcast, but we could not record it yet. Keep the transaction link and do not approve again.");
    } catch (caught) {
      if (!broadcasted) { setApprovalUncertain(true); setReviewErrorText(caught instanceof Error
        ? `${caught.message} Check your wallet activity before trying again.`
        : "The wallet did not return a hash. Check your wallet activity before trying again."); }
    } finally { setApproving(false); }
  }

  useEffect(() => {
    if (!approvalTrackingId || !approvalHash || ["confirmed", "failed", "inconsistent"].includes(approvalStatus ?? "")) return;
    let cancelled = false;
    const check = async () => {
      const token = await getAccessToken();
      if (!token || cancelled) return;
      const response = await fetch(`/api/swap/approval?approvalId=${encodeURIComponent(approvalTrackingId)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok || cancelled) return;
      const body = await response.json() as { status?: string };
      if (body.status === "prepared") {
        await fetch("/api/swap/approval", { method: "PATCH", cache: "no-store",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ approvalId: approvalTrackingId, transactionHash: approvalHash }) }).catch(() => undefined);
        return;
      }
      if (!cancelled && body.status) setApprovalStatus(body.status);
    };
    void check();
    const interval = window.setInterval(() => void check(), 5_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [approvalTrackingId, approvalHash, approvalStatus, getAccessToken]);

  async function confirmSwap() {
    if (!preparedSwap || !freshQuote || !address || submitting || submissionUncertain
      || submittedIntentId === preparedSwap.result.intentId && Boolean(submittedHash)
      || preparedSwap.planId !== freshQuote.planId) return;
    setReviewErrorText(null); setReportWarning(null); setSubmitting(true);
    let broadcasted = false;
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Your secure session expired. Sign in again before swapping.");
      const result = await submitPreparedSwap({ prepared: preparedSwap.result, walletAddress: address,
        reviewKey: preparedSwap.key, currentReviewKey: reviewKey, token,
        send: (transaction) => sendTransaction(transaction, { address,
          uiOptions: { description: `Exchange ${amount} ${source?.symbol ?? "tokens"}. Review the request in your wallet.`,
            buttonText: "Confirm swap", successHeader: "Swap submitted", isCancellable: true } }),
        onBroadcast: (hash) => { broadcasted = true; setSubmittedHash(hash); setSubmittedIntentId(preparedSwap.result.intentId); setReviewState("submitted"); }
      });
      if (!result.reportRecorded) setReportWarning("Your swap was broadcast, but Aurel could not record it yet. Do not submit it again. Keep the transaction link and contact support.");
    } catch (caught) {
      if (!broadcasted) {
        setSubmissionUncertain(true);
        setReviewErrorText(caught instanceof Error ? `${caught.message} Check your wallet activity before trying again.` : "Wallet confirmation did not return a hash. Check your wallet activity before trying again.");
      }
    } finally { setSubmitting(false); }
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
      {address ? <button className="button primary full swapReviewButton" type="submit" disabled={working || !source || !destination}>{working ? <LoaderCircle className="spin" size={16} /> : null}{working ? "Finding Routes" : "Find Route"}</button>
        : <button className="button primary full swapReviewButton" type="button" onClick={() => connectWallet()}>Connect Wallet</button>}
    </form>
    <div className="swapSettings"><span>Max Slippage</span><div>{[10, 50, 100].map((value) => <button type="button" key={value} className={slippageBps === value ? "active" : ""} aria-pressed={slippageBps === value} onClick={() => { setSlippageBps(value); clearReview(); }}>{value / 100}%</button>)}</div></div>
    {unverified.length > 0 && <label className="swapRiskCheck"><input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); clearReview(); }} /><span>I checked the contract {unverified.length > 1 ? "addresses" : "address"} for {unverified.map((asset) => `${asset.symbol} on ${assetNetwork(asset.chainId)}`).join(" and ")}.</span></label>}
    {error && <p className="formError" role="alert">{error}</p>}
    {liveResult && <section className="swapQuotes" aria-label="Available swap routes"><div className="swapQuotesHeader"><h3>Available Routes</h3><span>{liveResult.quotes.length} found</span></div>
      {liveResult.quotes.map((route) => <button type="button" className={`swapQuoteRow ${quote?.quoteId === route.quoteId ? "selected" : ""}`} key={route.planReference} onClick={() => { reviewVersion.current += 1; setSelectedQuoteId(route.quoteId); setReviewState("idle"); setReviewErrorText(null); }}><span><strong>{route.provider.replace(/^lifi:/, "")}</strong><small>{route.routeKind === "cross_chain" ? "Across networks" : "Same network"}</small></span><span><strong>{destination ? displayRawAmount(route.toAmountMinRaw, destination.decimals) : "—"} {destination?.symbol}</strong><small>{route.totalFeeUsd === null ? "Total fees unavailable" : `${formatEstimatedFeeUsd(route.totalFeeUsd)} estimated fees`}</small></span></button>)}
      {freshQuote && <div className="swapReview"><span>You Pay<strong>{amount} {source?.symbol}</strong></span><span>Minimum Received<strong>{destination ? displayRawAmount(freshQuote.toAmountMinRaw, destination.decimals) : "—"} {destination?.symbol}</strong></span><span>Estimated Fees<strong>{formatEstimatedFeeUsd(freshQuote.totalFeeUsd)}</strong></span><span>Price Impact<strong>{freshQuote.priceImpactPercent === null ? "Unavailable" : `${freshQuote.priceImpactPercent.toFixed(2)}%`}</strong></span></div>}
      <SwapRouteReview planId={freshQuote?.planId ?? null} fresh={Boolean(freshQuote)} walletAddress={address ?? null} busy={reviewing || submitting || approving || submissionUncertain || approvalUncertain || Boolean(approvalHash)}
        state={reviewState} routeKind={freshQuote?.routeKind} onReview={() => void reviewSelectedRoute()}
        onSubmit={preparedSwap && submittedIntentId !== preparedSwap.result.intentId && !submissionUncertain ? () => void confirmSwap() : undefined}
        onApprove={preparedApproval && !approvalHash && !approvalUncertain ? () => void confirmApproval() : undefined}
        approvalKind={preparedApproval?.kind}
        approvalAmount={preparedApproval && source ? `${displayRawAmount(preparedApproval.amountRaw, source.decimals)} ${source.symbol}` : undefined} />
      {reviewErrorText && <p className="formError" role="alert">{reviewErrorText}</p>}
    </section>}
    {approvalHash && <div className="swapReviewStatus" role="status"><strong>{approvalStatus === "confirmed" ? "Approval Confirmed" : approvalStatus === "failed" || approvalStatus === "inconsistent" ? "Approval Could Not Be Confirmed" : "Approval Pending"}</strong><span>{approvalStatus === "confirmed" ? "Find a new route before swapping. If this was a reset, another exact approval may be needed." : "This is separate from the swap. Do not submit another approval while it is pending."}</span></div>}
    {submittedHash && <TransactionProgress action="Swap" status="submitted" intentId={submittedIntentId} hashes={[submittedHash]} chainId={8453}
      submittedDetail={reportWarning ?? "Waiting for independent confirmation. You can leave this screen."} />}
    {reportWarning && <p className="formError" role="alert">{reportWarning}</p>}
    <PriceAlertPanel />
    <SwapReminderPanel fromAssetId={fromAssetId} toAssetId={toAssetId} amount={amount} onReview={(saved) => {
      setFromAssetId(saved.fromAssetId); setToAssetId(saved.toAssetId); setAmount(saved.amount); setAcknowledged(false); clearReview();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }} />
  </section>;
}
