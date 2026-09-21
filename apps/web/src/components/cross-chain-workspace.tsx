"use client";

import { useMfa, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { ArrowRight, Check, ExternalLink, LoaderCircle, Route, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, http, parseUnits } from "viem";
import { USDC_BY_CHAIN } from "@/config/chains";

type Quote = {
  quote: {
    id: string; tool: string;
    action: { fromChainId: number; toChainId: number; fromToken: { address: string; symbol: string; decimals: number }; toToken: { address: string; symbol: string; decimals: number } };
    estimate: { fromAmount: string; toAmount: string; toAmountMin: string; executionDuration?: number; approvalAddress?: string };
    transactionRequest: { to: string; data: string; value: string; chainId?: number };
  };
  observedAt: string;
};

const chainOptions = Object.entries(USDC_BY_CHAIN).map(([id, item]) => ({ id: Number(id), name: item.chain.name, chain: item.chain, address: item.address }));

function networkName(id: number) { return chainOptions.find((item) => item.id === id)?.name ?? `Chain ${id}`; }

export function CrossChainWorkspace() {
  const { wallets } = useWallets();
  const { getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const { mfaMethods } = useMfa();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const [fromChainId, setFromChainId] = useState(1);
  const [toChainId, setToChainId] = useState(8453);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  async function requestQuote(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setError(null); setQuote(null); setHash(null); setStage("Finding a live route");
    try {
      const token = await getAccessToken();
      if (!token || !wallet) throw new Error("Your secure session expired.");
      const response = await fetch("/api/routing/quote", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fromChainId, toChainId, amount, fromAddress: wallet.address }) });
      const body = await response.json() as Quote & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "No safe route is currently available.");
      setQuote(body); setStage(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No route is currently available."); setStage(null); }
    finally { setWorking(false); }
  }

  async function execute() {
    if (!quote || !wallet) return;
    setWorking(true); setError(null); setHash(null);
    let token: string | null = null; let intentId: string | undefined;
    try {
      token = await getAccessToken(); if (!token) throw new Error("Your secure session expired.");
      const source = chainOptions.find((item) => item.id === fromChainId); if (!source) throw new Error("Unsupported source network.");
      const rawAmount = parseUnits(amount, 6);
      const client = createPublicClient({ chain: source.chain, transport: http() });
      const approvalAddress = quote.quote.estimate.approvalAddress as `0x${string}` | undefined;
      if (approvalAddress) {
        setStage("Checking token approval");
        const allowance = await client.readContract({ address: source.address, abi: erc20Abi, functionName: "allowance", args: [wallet.address as `0x${string}`, approvalAddress] });
        if (allowance < rawAmount) {
          setStage("Approve this route in Privy");
          const approval = await sendTransaction({ to: source.address, chainId: fromChainId, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approvalAddress, rawAmount] }) }, { address: wallet.address, uiOptions: { description: `Approve exactly ${amount} USDC for this LI.FI route.`, buttonText: "Approve route", isCancellable: true } });
          setStage("Waiting for approval confirmation");
          const receipt = await client.waitForTransactionReceipt({ hash: approval.hash, confirmations: 1, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error("The token approval reverted. No bridge transaction was submitted.");
        }
      }
      setStage("Running Aurel policy checks");
      const intentResponse = await fetch("/api/intents/evaluate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "bridge", walletAddress: wallet.address, chainId: fromChainId, asset: "USDC", amount, destination: quote.quote.transactionRequest.to, estimatedUsd: Number(amount) }) });
      const intent = await intentResponse.json() as { intentId?: string; message?: string; decision?: { requiresStepUp?: boolean; findings?: Array<{ level: string; message: string }> } };
      if (!intentResponse.ok || !intent.intentId) throw new Error(intent.decision?.findings?.find((item) => item.level === "block")?.message ?? intent.message ?? "The route did not pass policy review.");
      intentId = intent.intentId;
      if (intent.decision?.requiresStepUp && !mfaMethods.includes("passkey")) throw new Error("Set up a passkey in the Safety center before this higher-risk cross-chain transfer.");
      setStage("Review the bridge transaction in Privy");
      const request = quote.quote.transactionRequest;
      const result = await sendTransaction({ to: request.to as `0x${string}`, data: request.data as `0x${string}`, value: BigInt(request.value || "0"), chainId: fromChainId }, { address: wallet.address, uiOptions: { description: `Route ${amount} USDC from ${networkName(fromChainId)} to ${networkName(toChainId)} through ${quote.quote.tool}.`, buttonText: "Confirm cross-chain transfer", isCancellable: true } });
      setHash(result.hash); setStage("Source transaction submitted");
      await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId, status: "submitted", transactionHash: result.hash, routeReference: quote.quote.id }) });
    } catch (caught) {
      if (intentId && token) await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId, status: "cancelled" }) }).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : "The route was not submitted."); setStage(null);
    } finally { setWorking(false); }
  }

  const received = quote ? formatUnits(BigInt(quote.quote.estimate.toAmountMin), quote.quote.action.toToken.decimals) : null;
  return <section className="panel routePanel"><div className="panelHeading"><div><p className="eyebrow">MULTICHAIN USDC · LIVE QUOTES</p><h2>Move liquidity to or from Base</h2><p className="sourceCaption">Privy controls authentication and signing. LI.FI supplies the route; its selected bridge contracts settle it.</p></div><Route size={20} /></div>
    <form className="routeForm" onSubmit={(event) => void requestQuote(event)}><label className="fieldLabel">From<select value={fromChainId} onChange={(event) => { setFromChainId(Number(event.target.value)); setQuote(null); }}>{chainOptions.map((item) => <option key={item.id} value={item.id} disabled={item.id === toChainId}>{item.name}</option>)}</select></label><label className="fieldLabel">To<select value={toChainId} onChange={(event) => { setToChainId(Number(event.target.value)); setQuote(null); }}>{chainOptions.map((item) => <option key={item.id} value={item.id} disabled={item.id === fromChainId}>{item.name}</option>)}</select></label><label className="fieldLabel routeAmount">USDC amount<input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); }} placeholder="0.00" /></label><button className="button secondary" disabled={working || !amount}>{working && !quote ? <LoaderCircle className="spin" size={15} /> : null}Get live route</button></form>
    {quote && <div className="routeQuote"><div><span>Guaranteed minimum</span><strong>{received} USDC</strong><small>on {networkName(toChainId)}</small></div><div><span>Route</span><strong>{quote.quote.tool}</strong><small>{quote.quote.estimate.executionDuration ? `~${Math.ceil(quote.quote.estimate.executionDuration / 60)} min estimate` : "Duration varies"}</small></div><div><span>Control</span><strong>User-signed</strong><small>Quote can change before signing</small></div><button className="button primary" type="button" disabled={working || Boolean(hash)} onClick={() => void execute()}>{working ? <LoaderCircle className="spin" size={15} /> : <ArrowRight size={15} />}{working ? stage : "Review and sign"}</button></div>}
    {error && <div className="formError" role="alert"><ShieldAlert size={15} /> {error}</div>}{hash && <a className="transactionSuccess" href={`${chainOptions.find((item) => item.id === fromChainId)?.chain.blockExplorers?.default.url}/tx/${hash}`} target="_blank" rel="noreferrer"><Check size={15} /> Source transaction submitted <ExternalLink size={13} /></a>}
    <p className="authorityFootnote">Cross-chain transfers add bridge, liquidity, smart-contract, and finality risk. A destination receipt is not guaranteed merely because the source transaction succeeded.</p>
  </section>;
}
