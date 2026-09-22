"use client";

import { useMfa, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { LoaderCircle, Route, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, http, isAddress, parseUnits } from "viem";
import { HOME_CHAIN, USDC_BY_CHAIN } from "@/config/chains";
import { routeQuoteIsFresh } from "@/lib/routing/lifi";
import { selectAutomaticSource } from "@/lib/routing/source-selection";
import type { TransactionLifecycleStatus } from "@/lib/transactions/lifecycle";
import { TransactionProgress } from "./transaction-progress";

type Quote = { quote: { id: string; tool: string; action: { fromChainId: number; toChainId: number; fromToken: { address: string; symbol: string; decimals: number }; toToken: { address: string; symbol: string; decimals: number } }; estimate: { fromAmount: string; toAmount: string; toAmountMin: string; executionDuration?: number; approvalAddress?: string }; transactionRequest: { to: string; data: string; value: string; chainId?: number } }; observedAt: string; expiresAt: string };
type Direction = "add" | "withdraw";
type Props = { initialDirection?: Direction };

const chainOptions = Object.entries(USDC_BY_CHAIN).map(([id, item]) => ({ id: Number(id), name: item.chain.name, chain: item.chain, address: item.address }));
function networkName(id: number) { return chainOptions.find((item) => item.id === id)?.name ?? `Network ${id}`; }

export function CrossChainWorkspace({ initialDirection = "add" }: Props) {
  const { wallets } = useWallets();
  const { getAccessToken } = usePrivy();
  const { sendTransaction } = useSendTransaction();
  const { mfaMethods } = useMfa();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const [direction, setDirection] = useState<Direction>(initialDirection);
  const [fromChainId, setFromChainId] = useState<number | null>(null);
  const [fromAddress, setFromAddress] = useState<string | null>(null);
  const [toChainId, setToChainId] = useState(1);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<TransactionLifecycleStatus | null>(null);

  function resetReview() {
    setQuote(null); setHash(null); setIntentId(null); setFlowStatus(null); setError(null); setFromChainId(null); setFromAddress(null); setStage(null);
  }

  async function findSource(requiredAmount: bigint) {
    if (!wallets.length) return null;
    const balances = await Promise.all(wallets.flatMap((connectedWallet) => chainOptions.filter((item) => item.id !== HOME_CHAIN.id).map(async (item) => {
      try {
        const client = createPublicClient({ chain: item.chain, transport: http() });
        const balance = await client.readContract({ address: item.address, abi: erc20Abi, functionName: "balanceOf", args: [connectedWallet.address as `0x${string}`] });
        return { chainId: item.id, walletAddress: connectedWallet.address, balance };
      } catch { return { chainId: item.id, walletAddress: connectedWallet.address, balance: 0n }; }
    })));
    return selectAutomaticSource(balances, requiredAmount, HOME_CHAIN.id);
  }

  async function requestQuote(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setError(null); setQuote(null); setHash(null); setIntentId(null); setFlowStatus(null); setFromChainId(null); setFromAddress(null); setStage("Checking your accounts");
    try {
      const token = await getAccessToken();
      if (!token || !wallet) throw new Error("Your secure session expired.");
      const rawAmount = parseUnits(amount, 6);
      if (rawAmount <= 0n) throw new Error("Enter an amount greater than zero.");
      let sourceChainId: number;
      let sourceAddress: string;
      let destinationChainId: number;
      let destinationAddress: string;
      if (direction === "add") {
        const source = await findSource(rawAmount);
        if (!source) throw new Error("No connected account has enough USD Coin on a supported network.");
        sourceChainId = source.chainId;
        sourceAddress = source.walletAddress;
        destinationChainId = HOME_CHAIN.id;
        destinationAddress = wallet.address;
      } else {
        destinationAddress = recipient.trim() || wallet.address;
        if (!isAddress(destinationAddress)) throw new Error("Enter a valid destination address.");
        if (toChainId === HOME_CHAIN.id) throw new Error("Choose another destination network, or use Send for a direct transfer.");
        const base = chainOptions.find((item) => item.id === HOME_CHAIN.id)!;
        const client = createPublicClient({ chain: base.chain, transport: http() });
        const balance = await client.readContract({ address: base.address, abi: erc20Abi, functionName: "balanceOf", args: [wallet.address as `0x${string}`] });
        if (balance < rawAmount) throw new Error("Your Aurel Account does not have enough USD Coin.");
        sourceChainId = HOME_CHAIN.id;
        sourceAddress = wallet.address;
        destinationChainId = toChainId;
      }
      setFromChainId(sourceChainId); setFromAddress(sourceAddress); setStage("Finding the best route");
      const response = await fetch("/api/routing/quote", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ fromChainId: sourceChainId, toChainId: destinationChainId, amount, fromAddress: sourceAddress, toAddress: destinationAddress }) });
      const body = await response.json() as Quote & { message?: string };
      if (!response.ok) throw new Error(body.message ?? "No route is currently available.");
      setQuote(body); setStage(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No route is currently available."); setStage(null); }
    finally { setWorking(false); }
  }

  async function execute() {
    if (!quote || !wallet || !fromChainId || !fromAddress) return;
    setWorking(true); setError(null); setHash(null); setIntentId(null); setFlowStatus("reviewing");
    let token: string | null = null; let intentId: string | undefined;
    try {
      token = await getAccessToken(); if (!token) throw new Error("Your secure session expired.");
      if (!routeQuoteIsFresh(quote.expiresAt)) { setQuote(null); throw new Error("This quote expired. Review a new quote to continue."); }
      const source = chainOptions.find((item) => item.id === fromChainId); if (!source) throw new Error("The source account is no longer available.");
      const signingWallet = wallets.find((item) => item.address.toLowerCase() === fromAddress.toLowerCase());
      if (!signingWallet) throw new Error("Reconnect the account selected for this transfer.");
      const rawAmount = parseUnits(amount, 6);
      const client = createPublicClient({ chain: source.chain, transport: http() });
      const currentBalance = await client.readContract({ address: source.address, abi: erc20Abi, functionName: "balanceOf", args: [fromAddress as `0x${string}`] });
      if (currentBalance < rawAmount) { setQuote(null); throw new Error("The selected account balance changed. Review a new quote to continue."); }
      setStage("Running safety checks");
      const beneficiary = direction === "withdraw" ? (recipient.trim() || wallet.address) : wallet.address;
      const intentResponse = await fetch("/api/intents/evaluate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: direction === "withdraw" ? "transfer" : "bridge", walletAddress: fromAddress, chainId: fromChainId, asset: "USDC", amount, destination: beneficiary, estimatedUsd: Number(amount) }) });
      const intent = await intentResponse.json() as { intentId?: string; message?: string; decision?: { requiresStepUp?: boolean; findings?: Array<{ level: string; message: string }> } };
      if (!intentResponse.ok || !intent.intentId) throw new Error(intent.decision?.findings?.find((item) => item.level === "block")?.message ?? intent.message ?? "The transfer did not pass safety review.");
      intentId = intent.intentId;
      setIntentId(intent.intentId);
      if (intent.decision?.requiresStepUp && !mfaMethods.includes("passkey")) throw new Error("Set up a passkey in Security before this transfer.");
      const approvalAddress = quote.quote.estimate.approvalAddress as `0x${string}` | undefined;
      if (approvalAddress) {
        setStage("Preparing your transfer");
        const allowance = await client.readContract({ address: source.address, abi: erc20Abi, functionName: "allowance", args: [fromAddress as `0x${string}`, approvalAddress] });
        if (allowance < rawAmount) {
          const approvalData = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approvalAddress, rawAmount] });
          setStage("Checking the approval");
          await client.estimateGas({ account: fromAddress as `0x${string}`, to: source.address, data: approvalData, value: 0n });
          await client.call({ account: fromAddress as `0x${string}`, to: source.address, data: approvalData, value: 0n });
          setStage("Review the approval");
          setFlowStatus("awaiting_confirmation");
          const approval = await sendTransaction({ to: source.address, chainId: fromChainId, value: 0n, data: approvalData }, { address: signingWallet.address, uiOptions: { description: `Approve exactly ${amount} USDC for this transfer.`, buttonText: "Approve transfer", isCancellable: true } });
          setStage("Confirming approval");
          setFlowStatus("reviewing");
          const receipt = await client.waitForTransactionReceipt({ hash: approval.hash, confirmations: 1, timeout: 120_000 });
          if (receipt.status !== "success") throw new Error("The approval did not complete. No transfer was submitted.");
          if (!routeQuoteIsFresh(quote.expiresAt)) { setQuote(null); throw new Error("The approval is complete, but the quote expired. Review a new quote to continue."); }
        }
      }
      const request = quote.quote.transactionRequest;
      const transaction = { account: fromAddress as `0x${string}`, to: request.to as `0x${string}`, data: request.data as `0x${string}`, value: BigInt(request.value || "0") };
      setStage("Checking the transfer");
      await client.estimateGas(transaction);
      await client.call(transaction);
      setStage("Confirm in your wallet");
      setFlowStatus("awaiting_confirmation");
      const result = await sendTransaction({ to: request.to as `0x${string}`, data: request.data as `0x${string}`, value: BigInt(request.value || "0"), chainId: fromChainId }, { address: signingWallet.address, uiOptions: { description: direction === "add" ? `Add ${amount} USDC to your Aurel Account.` : `Withdraw ${amount} USDC to ${networkName(quote.quote.action.toChainId)}.`, buttonText: direction === "add" ? "Confirm add money" : "Confirm withdrawal", isCancellable: true } });
      setHash(result.hash); setStage(null); setFlowStatus("submitted");
      await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId, status: "submitted", transactionHash: result.hash, routeReference: quote.quote.id }) });
    } catch (caught) {
      if (intentId && token) await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId, status: "cancelled" }) }).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : "The transfer was not submitted."); setStage(null); setFlowStatus("failed");
    } finally { setWorking(false); }
  }

  const received = quote ? formatUnits(BigInt(quote.quote.estimate.toAmountMin), quote.quote.action.toToken.decimals) : null;
  return <section className="panel routePanel exchangePanel" id="digital-money">
    <div className="panelHeading"><div><h2>Move USD Coin</h2><p>Aurel finds the route. You approve the transfer.</p></div><Route size={20} /></div>
    <div className="segmentedControl routeDirection"><button type="button" className={direction === "add" ? "active" : ""} onClick={() => { setDirection("add"); resetReview(); }}>Add Money</button><button type="button" className={direction === "withdraw" ? "active" : ""} onClick={() => { setDirection("withdraw"); resetReview(); }}>Withdraw</button></div>
    <form className="exchangeForm" onSubmit={(event) => void requestQuote(event)}>
      <div className="exchangeAsset"><span>{direction === "add" ? "From" : "You Send"}</span><strong>{direction === "add" ? "Connected Account" : "Aurel Account"}</strong><small>USD Coin</small></div>
      <label className="fieldLabel exchangeAmount">Amount<input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setQuote(null); setHash(null); }} placeholder="0.00" /></label>
      {direction === "add" ? <div className="exchangeAsset destination"><span>To</span><strong>Aurel Account</strong><small>USD Coin</small></div> : <><label className="fieldLabel routeDestination">Destination Network<select value={toChainId} onChange={(event) => { setToChainId(Number(event.target.value)); setQuote(null); }}>{chainOptions.filter((item) => item.id !== HOME_CHAIN.id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="fieldLabel routeRecipient">Destination Address<input autoComplete="off" spellCheck={false} value={recipient} onChange={(event) => { setRecipient(event.target.value.trim()); setQuote(null); }} placeholder={wallet?.address ?? "0x…"} /></label></>}
      <button className="button secondary" disabled={working || !amount}>{working && !quote ? <LoaderCircle className="spin" size={15} /> : null}{working && !quote ? stage : "Review Quote"}</button>
    </form>
    {quote && <div className="routeQuote"><div><span>You Send</span><strong>{amount} USDC</strong><small>Source selected automatically</small></div><div><span>You Receive At Least</span><strong>{received} USDC</strong><small>{quote.quote.estimate.executionDuration ? `About ${Math.max(1, Math.ceil(quote.quote.estimate.executionDuration / 60))} min` : "Arrival time varies"}</small></div><div><span>Routing</span><strong>Automatic</strong><small>You approve every transaction</small></div><button className="button primary" type="button" disabled={working || Boolean(hash)} onClick={() => void execute()}>{working ? <LoaderCircle className="spin" size={15} /> : null}{working ? stage : direction === "add" ? "Confirm Add Money" : "Confirm Withdrawal"}</button></div>}
    {flowStatus && <TransactionProgress action={direction === "add" ? "Add Money" : "Withdrawal"} status={flowStatus} stage={stage} error={error} intentId={intentId} hashes={hash ? [hash] : []} chainId={fromChainId ?? HOME_CHAIN.id} submittedDetail={direction === "add" ? "Your balance will update after the route completes." : "Arrival time depends on the destination network."} />}
    {!flowStatus && error && <div className="formError" role="alert"><ShieldAlert size={15} /> {error}</div>}
    {quote && fromChainId && <details className="technicalDetails"><summary>Technical Details</summary><span>From {networkName(fromChainId)} to {networkName(quote.quote.action.toChainId)} · Route provider: {quote.quote.tool}</span></details>}
    <p className="authorityFootnote">Rates, fees, and arrival times can change before confirmation. Cross-network transfers are never automatic.</p>
  </section>;
}
