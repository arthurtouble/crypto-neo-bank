"use client";

import { usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, LoaderCircle, QrCode, Send, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { erc20Abi, formatUnits, isAddress, parseEther, parseUnits, encodeFunctionData, toHex } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { BASE_ASSETS, HOME_CHAIN, SUPPORTED_CHAINS } from "@/config/chains";
import { DefiPositions } from "./defi-positions";
import { TransactionProgress } from "./transaction-progress";
import type { TransactionLifecycleStatus } from "@/lib/transactions/lifecycle";
import { submitPreparedTransfer, WalletOutcomeUnknownError } from "@/lib/transactions/prepare-client";

type AssetSymbol = keyof typeof BASE_ASSETS;
type Modal = "receive" | "send" | null;
type Recipient = { id: string; kind: "wallet" | "bank"; name: string; destination: string; detail: string; verified: boolean; recent?: boolean };

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function amountText(value: bigint | undefined, decimals: number) {
  if (value === undefined) return "—";
  const numeric = Number(formatUnits(value, decimals));
  return numeric.toLocaleString(undefined, { maximumFractionDigits: numeric < 1 ? 6 : 4 });
}

export function WalletWorkspace({ mode = "overview" }: { mode?: "overview" | "deposit" | "send" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getAccessToken } = usePrivy();
  const { wallets, ready } = useWallets();
  const { sendTransaction } = useSendTransaction();
  const requestedRecipient = searchParams.get("sendTo") ?? "";
  const requestedTag = searchParams.get("tag");
  const requestedAsset = searchParams.get("asset");
  const initialAsset = requestedAsset && requestedAsset in BASE_ASSETS ? requestedAsset as AssetSymbol : "USDC";
  const [modal, setModal] = useState<Modal>(isAddress(requestedRecipient) ? "send" : null);
  const [asset, setAsset] = useState<AssetSymbol>(initialAsset);
  const [recipient, setRecipient] = useState(isAddress(requestedRecipient) ? requestedRecipient : "");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<TransactionLifecycleStatus | null>(null);
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  const [submittedSummary, setSubmittedSummary] = useState<string | null>(null);
  const [reviewedSourceAddress, setReviewedSourceAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [receiveChainId, setReceiveChainId] = useState<number>(HOME_CHAIN.id);
  const embedded = useMemo(() => wallets.find((wallet) => wallet.walletClientType === "privy") ?? wallets[0], [wallets]);
  const address = embedded?.address as `0x${string}` | undefined;
  const transferKey = JSON.stringify([modal, address, asset, recipient, amount]);
  const liveTransferKey = useRef(transferKey);
  const transferRevision = useRef(0);
  useLayoutEffect(() => {
    if (liveTransferKey.current !== transferKey) { liveTransferKey.current = transferKey; transferRevision.current += 1; }
  }, [transferKey]);
  const eth = useBalance({ address, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const usdc = useReadContract({ address: BASE_ASSETS.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const weth = useReadContract({ address: BASE_ASSETS.WETH.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const recipients = useQuery<{ recipients: Recipient[] }>({
    queryKey: ["recipients", address],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/recipients", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Recipients are unavailable.");
      return response.json();
    },
    enabled: Boolean(address && modal === "send")
  });
  const savedRecipients = recipients.data?.recipients.filter((item) => item.kind === "wallet" && item.verified && !item.recent) ?? [];

  const rows = [
    { ...BASE_ASSETS.USDC, value: usdc.data, source: "Aura Wallet", pending: usdc.isPending },
    { ...BASE_ASSETS.ETH, value: eth.data?.value, source: "Aura Wallet", pending: eth.isPending },
    { ...BASE_ASSETS.WETH, value: weth.data, source: "Aura Wallet", pending: weth.isPending }
  ];

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function openSend(symbol: AssetSymbol = "USDC") {
    if (sending) return;
    if (submissionUncertain) { setModal("send"); return; }
    setAsset(symbol);
    setRecipient("");
    setAmount("");
    setError(null);
    setHash(null);
    setIntentId(null);
    setFlowStatus(null);
    setSubmissionUncertain(false);
    setSubmittedSummary(null);
    setReviewedSourceAddress(null);
    setModal("send");
  }

  async function submitSend(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setHash(null);
    if (!address) return setError("Your wallet is not ready yet.");
    if (!isAddress(recipient)) return setError("Enter a valid EVM destination address.");
    if (!amount || Number(amount) <= 0) return setError("Enter an amount greater than zero.");

    const definition = BASE_ASSETS[asset];
    let rawAmount: bigint;
    try { rawAmount = asset === "ETH" ? parseEther(amount) : parseUnits(amount, definition.decimals); }
    catch { return setError(`Enter a valid ${asset} amount.`); }
    if (rawAmount <= 0n) return setError("Enter an amount greater than zero.");
    const transaction = asset === "ETH"
      ? { to: recipient as `0x${string}`, value: rawAmount, chainId: HOME_CHAIN.id }
      : {
          to: definition.address as `0x${string}`,
          value: 0n,
          chainId: HOME_CHAIN.id,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient as `0x${string}`, rawAmount] })
        };
    const reviewedSelection = transferKey;
    const reviewedRevision = transferRevision.current;
    const reviewedSummary = `${amount} ${asset} from ${shortAddress(address)} to ${shortAddress(recipient)}`;

    setSending(true);
    setReviewedSourceAddress(address);
    setFlowStatus("reviewing");
    let reviewedIntentId: string | undefined;
    let accessToken: string | null = null;
    try {
      accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Your secure session expired. Sign in again before sending.");
      async function verifyTagRecipient() {
        if (!requestedTag) return;
        const response = await fetch(`/api/aura-tags/${encodeURIComponent(requestedTag)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("This Aura tag is no longer available. Find the recipient again.");
        const tag = await response.json() as { crypto: { address: string } };
        if (tag.crypto.address.toLowerCase() !== recipient.toLowerCase()) throw new Error("The Aura tag destination changed. Find the recipient again before signing.");
      }
      await verifyTagRecipient();
      const intentResponse = await fetch("/api/intents/evaluate", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "transfer",
          walletAddress: address,
          chainId: HOME_CHAIN.id,
          asset,
          amount,
          destination: recipient,
          estimatedUsd: asset === "USDC" ? Number(amount) : undefined
        })
      });
      const intent = await intentResponse.json() as { intentId?: string; decision?: { requiresStepUp?: boolean; findings: Array<{ level: string; message: string }> }; message?: string };
      if (!intentResponse.ok || !intent.intentId) {
        const blocked = intent.decision?.findings.find((finding) => finding.level === "block");
        throw new Error(blocked?.message ?? intent.message ?? "Aura’s transaction policy could not approve this action.");
      }
      reviewedIntentId = intent.intentId;
      setIntentId(intent.intentId);
      if (intent.decision?.requiresStepUp) throw new Error("This higher-risk transfer is unavailable until Aura can verify step-up for this exact action.");
      const result = await submitPreparedTransfer({
        accessToken, intentId: intent.intentId,
        step: {
          call: { chainId: HOME_CHAIN.id, from: address, to: transaction.to, value: asset === "ETH" ? rawAmount : 0n, data: asset === "ETH" ? "0x" : transaction.data ?? "0x" },
          semanticAction: asset === "ETH" ? "native_transfer" : "erc20_transfer",
          sourceReference: "direct-transfer-review",
          expectedEffect: asset === "ETH"
            ? { type: "native_transfer", recipient, amountRaw: rawAmount.toString() }
            : { type: "erc20_transfer", token: definition.address, recipient, amountRaw: rawAmount.toString() }
        },
        simulate: async () => {
          const provider = await embedded.getEthereumProvider();
          const simulation = asset === "ETH"
            ? { from: address, to: recipient, value: toHex(rawAmount) }
            : { from: address, to: definition.address, value: "0x0", data: transaction.data };
          await provider.request({ method: "eth_estimateGas", params: [simulation] });
          if (asset !== "ETH") await provider.request({ method: "eth_call", params: [simulation, "latest"] });
        },
        isReviewCurrent: () => liveTransferKey.current === reviewedSelection && transferRevision.current === reviewedRevision,
        send: async () => {
          await verifyTagRecipient();
          setFlowStatus("awaiting_confirmation");
          return sendTransaction(transaction, {
            address,
            uiOptions: {
              description: `Send ${amount} ${asset} from your Aura account to ${shortAddress(recipient)}.`,
              buttonText: "Confirm transfer",
              successHeader: "Transfer submitted",
              isCancellable: true
            }
          });
        }
      });
      setHash(result.hash);
      setSubmittedSummary(reviewedSummary);
      setFlowStatus("submitted");
      if (!result.reportRecorded) setError("The transfer was broadcast, but Aura could not record its hash yet. Do not send it again; contact support with the transaction link.");
      await Promise.allSettled([eth.refetch(), usdc.refetch(), weth.refetch()]);
    } catch (sendError) {
      const uncertain = sendError instanceof WalletOutcomeUnknownError;
      if (!uncertain && reviewedIntentId && accessToken) {
        await fetch("/api/intents/status", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ intentId: reviewedIntentId, status: "cancelled" })
        }).catch(() => undefined);
      }
      if (uncertain || liveTransferKey.current === reviewedSelection && transferRevision.current === reviewedRevision) {
        setError(sendError instanceof Error ? sendError.message : "Review this transfer again before continuing.");
        setFlowStatus(uncertain ? "awaiting_confirmation" : null);
        setSubmissionUncertain(uncertain);
        if (uncertain) setSubmittedSummary(reviewedSummary);
        else setReviewedSourceAddress(null);
      }
    } finally {
      setSending(false);
    }
  }

  if (!ready || !address) {
    return <section className="panel walletLoading"><LoaderCircle className="spin" size={20} /><div><strong>Preparing your account</strong>{(sending || submissionUncertain) && <p role="alert">A transfer from {reviewedSourceAddress ? shortAddress(reviewedSourceAddress) : "your wallet"} may be pending. Check that wallet’s activity before trying again.</p>}</div></section>;
  }

  return (
    <>
      <div className="contentGrid">
        <section className="panel widePanel">
          <div className="panelHeading walletHeading">
            <div><h2>{mode === "deposit" ? "Receive crypto" : mode === "send" ? "Send crypto" : "Cash and crypto"}</h2></div>
            <div className="walletActions">{mode !== "send" && <button className="button secondary" disabled={sending || submissionUncertain} onClick={() => { if (!sending && !submissionUncertain) setModal("receive"); }}><QrCode size={16} /> Receive</button>}{mode !== "deposit" && <button className="button primary" disabled={sending} onClick={() => openSend()}><Send size={16} /> Send</button>}</div>
          </div>
          <div className="assetTable liveAssetTable">
            <div className="tableHead"><span>Asset</span><span>Source</span><span>Status</span><span>Balance</span></div>
            {rows.map((row, index) => (
              <button className="tableRow assetActionRow" key={row.symbol} disabled={sending || mode === "deposit"} onClick={() => openSend(row.symbol)}>
                <span className={`assetToken token${index}`}>{row.symbol.slice(0, 1)}</span>
                <span><strong>{row.name}</strong><small>{row.symbol}</small></span>
                <span>{row.source}</span>
                <span><i className={row.pending ? "sourceDot pending" : "sourceDot"} /> {row.pending ? "Reading" : row.value === undefined ? "Unavailable" : "Observed now"}</span>
                <span className="sensitiveAmount"><strong>{amountText(row.value, row.decimals)}</strong><small>{row.symbol}</small></span>
              </button>
            ))}
          </div>
        </section>

      </div>
      {mode === "overview" && <DefiPositions address={address} />}

      {modal && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !sending && setModal(null)}>
        <section className="financialModal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
          <button className="modalClose" onClick={() => setModal(null)} aria-label="Close" disabled={sending}><X size={18} /></button>
          {modal === "receive" ? <>
            <h2 id="wallet-modal-title">Add USD Coin</h2>
            <p>Choose where you are sending from, then copy your address.</p>
            <label className="fieldLabel">Sending From<select value={receiveChainId} onChange={(event) => setReceiveChainId(Number(event.target.value))}>{SUPPORTED_CHAINS.map((chain) => <option value={chain.id} key={chain.id}>{chain.name}</option>)}</select></label>
            <div className="receiveQr"><QRCodeSVG value={address} size={164} bgColor="transparent" fgColor="currentColor" level="M" /></div>
            <code className="addressBlock">{address}</code>
            <button className="button primary full" onClick={() => void copyAddress()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy address"}</button>
            {receiveChainId !== HOME_CHAIN.id && <button className="button secondary full" onClick={() => { setModal(null); router.push("/app/swap"); }}>Swap or bridge to Base</button>}
            <div className="modalRisk">Only send USDC on {SUPPORTED_CHAINS.find((chain) => chain.id === receiveChainId)?.name}. Funds sent elsewhere may not appear.</div>
            {receiveChainId !== HOME_CHAIN.id && <p className="authorityFootnote">Your USDC remains on the selected network until you review and approve a route into your Aura balance.</p>}
          </> : <form onSubmit={(event) => void submitSend(event)}>
            <h2 id="wallet-modal-title">Send</h2>
            <label className="fieldLabel">Asset<select value={asset} disabled={sending || submissionUncertain || Boolean(hash)} onChange={(event) => setAsset(event.target.value as AssetSymbol)}>{Object.keys(BASE_ASSETS).map((symbol) => <option key={symbol}>{symbol}</option>)}</select></label>
            <label className="fieldLabel">Amount<input inputMode="decimal" placeholder="0.00" value={amount} disabled={sending || submissionUncertain || Boolean(hash)} onChange={(event) => setAmount(event.target.value)} /></label>
            {savedRecipients.length > 0 && <label className="fieldLabel">Saved Recipient<select value={savedRecipients.some((item) => item.destination === recipient) ? recipient : ""} disabled={sending || submissionUncertain || Boolean(hash)} onChange={(event) => setRecipient(event.target.value)}><option value="">Enter another address</option>{savedRecipients.map((item) => <option key={item.id} value={item.destination}>{item.name} · {item.detail}</option>)}</select></label>}
            <label className="fieldLabel">Destination<input autoComplete="off" spellCheck={false} placeholder="0x…" value={recipient} disabled={sending || submissionUncertain || Boolean(hash)} onChange={(event) => setRecipient(event.target.value.trim())} /></label>
            <div className="transactionSummary"><span>From<strong>Aura account</strong></span><span>Account<strong>{shortAddress(reviewedSourceAddress ?? address)}</strong></span><span>Review<strong>You Confirm</strong></span></div>
            {flowStatus && <TransactionProgress action="Transfer" status={flowStatus} stage={submissionUncertain ? "Check Wallet Activity" : submittedSummary ? `Transfer: ${submittedSummary}` : undefined} error={error} intentId={intentId} hashes={hash ? [hash] : []} chainId={HOME_CHAIN.id} onConfirmed={() => { void Promise.all([eth.refetch(), usdc.refetch(), weth.refetch()]); }} />}
            {!flowStatus && error && <p className="formError" role="alert">{error}</p>}
            <button className="button primary full" disabled={sending || Boolean(hash) || submissionUncertain}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{hash ? "Transfer Submitted" : submissionUncertain ? "Check Wallet Activity" : sending ? "Awaiting Confirmation" : "Review Transfer"}</button>
          </form>}
        </section>
      </div>}
    </>
  );
}
