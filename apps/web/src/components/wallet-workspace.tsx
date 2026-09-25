"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, LoaderCircle, QrCode, Send, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { erc20Abi, formatUnits, isAddress } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { BASE_ASSETS, HOME_CHAIN, SUPPORTED_CHAINS } from "@/config/chains";
import { useApi } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { DefiPositions } from "./defi-positions";
import { TransactionProgress } from "./transaction-progress";

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

function assetId(symbol: AssetSymbol) {
  const { address } = BASE_ASSETS[symbol];
  return address ? `${HOME_CHAIN.id}:${address.toLowerCase()}` : `${HOME_CHAIN.id}:native`;
}

export function WalletWorkspace({ mode = "overview" }: { mode?: "overview" | "deposit" | "send" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const api = useApi();
  const requestedRecipient = searchParams.get("sendTo") ?? "";
  const requestedTag = searchParams.get("tag");
  const requestedAsset = searchParams.get("asset");
  const initialAsset = requestedAsset && requestedAsset in BASE_ASSETS ? requestedAsset as AssetSymbol : "USDC";
  const [modal, setModal] = useState<Modal>(isAddress(requestedRecipient) ? "send" : null);
  const [asset, setAsset] = useState<AssetSymbol>(initialAsset);
  const [recipient, setRecipient] = useState(isAddress(requestedRecipient) ? requestedRecipient : "");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [receiveChainId, setReceiveChainId] = useState<number>(HOME_CHAIN.id);
  // useAction refreshes every query (balances included) when an action settles.
  const transfer = useAction();
  const { address, ready } = transfer.wallet;
  const sending = transfer.busy;
  const inFlight = transfer.phase !== "idle" || transfer.outcomeUnknown;
  const eth = useBalance({ address, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const usdc = useReadContract({ address: BASE_ASSETS.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const weth = useReadContract({ address: BASE_ASSETS.WETH.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const recipients = useQuery<{ recipients: Recipient[] }>({
    queryKey: ["recipients", address],
    queryFn: () => api("/api/recipients"),
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
    // Keep an unsettled or uncertain transfer on screen instead of starting a new one.
    if (transfer.phase === "tracking" || transfer.outcomeUnknown) { setModal("send"); return; }
    transfer.reset();
    setAsset(symbol);
    setRecipient("");
    setAmount("");
    setFormError(null);
    setModal("send");
  }

  async function verifyTagRecipient() {
    if (!requestedTag) return;
    const response = await fetch(`/api/aura-tags/${encodeURIComponent(requestedTag)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("This Aura tag is no longer available. Find the recipient again.");
    const tag = await response.json() as { crypto: { address: string } };
    if (tag.crypto.address.toLowerCase() !== recipient.toLowerCase()) throw new Error("The Aura tag address changed. Find the recipient again before sending.");
  }

  async function submitSend(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!address) return setFormError("Your wallet isn't ready yet.");
    if (!isAddress(recipient)) return setFormError("Enter a valid address.");
    if (!/^\d*\.?\d+$/.test(amount) || Number(amount) <= 0) return setFormError("Enter an amount greater than zero.");
    try { await verifyTagRecipient(); }
    catch (reason) { return setFormError(reason instanceof Error ? reason.message : "Find the recipient again."); }
    await transfer.run({ kind: "transfer", assetId: assetId(asset), amount, to: recipient }, () => ({
      description: `Send ${amount} ${asset} to ${shortAddress(recipient)}.`,
      buttonText: "Send"
    }));
  }

  if (!ready || !address) {
    return <section className="panel walletLoading"><LoaderCircle className="spin" size={20} /><div><strong>Preparing your account</strong>{inFlight && <p role="alert">A transfer may be pending. Check Transactions before you try again.</p>}</div></section>;
  }

  return (
    <>
      <div className="contentGrid">
        <section className="panel widePanel">
          <div className="panelHeading walletHeading">
            <div><h2>{mode === "deposit" ? "Receive crypto" : mode === "send" ? "Send crypto" : "Cash and crypto"}</h2></div>
            <div className="walletActions">{mode !== "send" && <button className="button secondary" disabled={sending} onClick={() => { if (!sending) setModal("receive"); }}><QrCode size={16} /> Receive</button>}{mode !== "deposit" && <button className="button primary" disabled={sending} onClick={() => openSend()}><Send size={16} /> Send</button>}</div>
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
            <label className="fieldLabel">Asset<select value={asset} disabled={inFlight} onChange={(event) => setAsset(event.target.value as AssetSymbol)}>{Object.keys(BASE_ASSETS).map((symbol) => <option key={symbol}>{symbol}</option>)}</select></label>
            <label className="fieldLabel">Amount<input inputMode="decimal" placeholder="0.00" value={amount} disabled={inFlight} onChange={(event) => setAmount(event.target.value)} /></label>
            {savedRecipients.length > 0 && <label className="fieldLabel">Saved Recipient<select value={savedRecipients.some((item) => item.destination === recipient) ? recipient : ""} disabled={inFlight} onChange={(event) => setRecipient(event.target.value)}><option value="">Enter another address</option>{savedRecipients.map((item) => <option key={item.id} value={item.destination}>{item.name} · {item.detail}</option>)}</select></label>}
            <label className="fieldLabel">Destination<input autoComplete="off" spellCheck={false} placeholder="0x…" value={recipient} disabled={inFlight} onChange={(event) => setRecipient(event.target.value.trim())} /></label>
            <div className="transactionSummary"><span>From<strong>Aura account</strong></span><span>Account<strong>{shortAddress(address)}</strong></span><span>Review<strong>You confirm</strong></span></div>
            {formError && <p className="formError" role="alert">{formError}</p>}
            <TransactionProgress label="Transfer" phase={transfer.phase} action={transfer.action} error={transfer.error} outcomeUnknown={transfer.outcomeUnknown} />
            {transfer.phase === "done"
              ? <button type="button" className="button primary full" onClick={() => { transfer.reset(); setAmount(""); }}><Send size={16} /> New transfer</button>
              : <button className="button primary full" disabled={inFlight}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{transfer.outcomeUnknown ? "Check Transactions first" : transfer.phase === "tracking" ? "Sending" : transfer.phase === "preparing" ? "Checking" : sending ? "Confirm in your wallet" : "Send"}</button>}
          </form>}
        </section>
      </div>}
    </>
  );
}
