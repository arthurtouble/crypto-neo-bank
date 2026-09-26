"use client";

import { useQuery } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { LoaderCircle, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { erc20Abi, formatUnits, isAddress } from "viem";
import { useBalance, useReadContracts } from "wagmi";
import { HOME_CHAIN } from "@/config/chains";
import { assetsFor } from "@/lib/assets/registry";
import { useApi } from "@/lib/client/api";
import { useAction } from "@/lib/client/use-action";
import { MovePreviousAccount } from "./move-previous-account";
import { TransactionProgress } from "./transaction-progress";

/** What can be sent: the registry's "send" assets on Base. The server checks the same list and any pause. */
const SENDABLE = assetsFor("send", HOME_CHAIN.id);
const TOKENS = SENDABLE.filter((item) => item.address !== null);
type AssetSymbol = string;
type Modal = "send" | null;
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
  return SENDABLE.find((item) => item.symbol === symbol)?.id ?? SENDABLE[0].id;
}

/** Send crypto from the Aura account. Deposits are in DepositWorkspace. */
export function WalletWorkspace() {
  const searchParams = useSearchParams();
  const api = useApi();
  const requestedRecipient = searchParams.get("sendTo") ?? "";
  const requestedTag = searchParams.get("tag");
  const requestedAsset = searchParams.get("asset");
  const initialAsset = SENDABLE.some((item) => item.symbol === requestedAsset) ? requestedAsset! : "USDC";
  const [modal, setModal] = useState<Modal>(isAddress(requestedRecipient) ? "send" : null);
  const [asset, setAsset] = useState<AssetSymbol>(initialAsset);
  const [recipient, setRecipient] = useState(isAddress(requestedRecipient) ? requestedRecipient : "");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [slowSetup, setSlowSetup] = useState(false);
  const { user } = usePrivy();
  // Wallets the customer linked to their login, such as MetaMask. Never the Privy signer, which isn't theirs to send to.
  const ownWallets = (user?.linkedAccounts ?? []).flatMap((account) => account.type === "wallet" && account.chainType === "ethereum"
    && !account.walletClientType?.startsWith("privy") && isAddress(account.address, { strict: false }) ? [account.address.toLowerCase()] : []);
  // useAction refreshes every query (balances included) when an action settles.
  const transfer = useAction({ label: "Transfer" });
  const { address, ready } = transfer.wallet;
  const sending = transfer.busy;
  const inFlight = transfer.phase !== "idle" || transfer.outcomeUnknown;
  const eth = useBalance({ address, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const tokens = useReadContracts({ contracts: TOKENS.map((item) => ({ address: item.address!, abi: erc20Abi, functionName: "balanceOf" as const,
    args: [address!] as const, chainId: HOME_CHAIN.id })), query: { enabled: Boolean(address) } });
  const recipients = useQuery<{ recipients: Recipient[] }>({
    queryKey: ["recipients", address],
    queryFn: () => api("/api/recipients"),
    enabled: Boolean(address && modal === "send")
  });
  const savedRecipients = recipients.data?.recipients.filter((item) => item.kind === "wallet" && item.verified && !item.recent) ?? [];

  const rows = SENDABLE.map((item) => {
    const index = TOKENS.indexOf(item);
    const value = index < 0 ? eth.data?.value : tokens.data?.[index]?.status === "success" ? tokens.data[index].result as bigint : undefined;
    return { ...item, value, source: "Aura Wallet", pending: index < 0 ? eth.isPending : tokens.isPending };
  });

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
    await transfer.run({ kind: "transfer", assetId: assetId(asset), amount, to: recipient });
  }

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setSlowSetup(true), 15_000);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (!ready || !address) {
    return <section className="panel walletLoading"><LoaderCircle className="spin" size={20} /><div><strong>Setting up your account</strong>
      {slowSetup && <p>This is taking longer than usual. Refresh the page. If it keeps happening, contact support.</p>}
      {inFlight && <p role="alert">A transfer may be pending. Check Transactions before you try again.</p>}</div></section>;
  }

  return (
    <>
      <MovePreviousAccount />
      <div className="contentGrid">
        <section className="panel widePanel">
          <div className="panelHeading walletHeading">
            <div><h2>Send crypto</h2></div>
            <div className="walletActions"><button className="button primary" disabled={sending} onClick={() => openSend()}><Send size={16} /> Send</button></div>
          </div>
          <div className="assetTable liveAssetTable">
            <div className="tableHead"><span>Asset</span><span>Source</span><span>Status</span><span>Balance</span></div>
            {rows.map((row, index) => (
              <button className="tableRow assetActionRow" key={row.symbol} disabled={sending} onClick={() => openSend(row.symbol)}>
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

      {modal && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !sending && setModal(null)}>
        <section className="financialModal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
          <button className="modalClose" onClick={() => setModal(null)} aria-label="Close" disabled={sending}><X size={18} /></button>
          <form onSubmit={(event) => void submitSend(event)}>
            <h2 id="wallet-modal-title">Send</h2>
            <label className="fieldLabel">Asset<select value={asset} disabled={inFlight} onChange={(event) => setAsset(event.target.value as AssetSymbol)}>{SENDABLE.map((item) => <option key={item.id}>{item.symbol}</option>)}</select></label>
            <label className="fieldLabel">Amount<input inputMode="decimal" placeholder="0.00" value={amount} disabled={inFlight} onChange={(event) => setAmount(event.target.value)} /></label>
            {savedRecipients.length > 0 && <label className="fieldLabel">Saved Recipient<select value={savedRecipients.some((item) => item.destination === recipient) ? recipient : ""} disabled={inFlight} onChange={(event) => setRecipient(event.target.value)}><option value="">Enter another address</option>{savedRecipients.map((item) => <option key={item.id} value={item.destination}>{item.name} · {item.detail}</option>)}</select></label>}
            <label className="fieldLabel">Destination<input autoComplete="off" spellCheck={false} placeholder="0x…" value={recipient} disabled={inFlight} onChange={(event) => setRecipient(event.target.value.trim())} /></label>
            {ownWallets.filter((wallet) => wallet !== recipient.toLowerCase()).slice(0, 3).map((wallet) =>
              <button type="button" className="button secondary full" key={wallet} disabled={inFlight} onClick={() => setRecipient(wallet)}>Send to my wallet · {shortAddress(wallet)}</button>)}
            <div className="transactionSummary"><span>From<strong>Aura account</strong></span><span>Account<strong>{shortAddress(address)}</strong></span><span>Review<strong>You confirm</strong></span></div>
            {formError && <p className="formError" role="alert">{formError}</p>}
            <TransactionProgress label="Transfer" phase={transfer.phase} action={transfer.action} outcomeUnknown={transfer.outcomeUnknown} />
            {transfer.phase === "done"
              ? <button type="button" className="button primary full" onClick={() => { transfer.reset(); setAmount(""); }}><Send size={16} /> New transfer</button>
              : <button className="button primary full" disabled={inFlight}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{transfer.outcomeUnknown ? "Check Transactions first" : transfer.phase === "tracking" ? "Sending" : transfer.phase === "preparing" ? "Checking" : sending ? "Confirm in your wallet" : "Send"}</button>}
          </form>
        </section>
      </div>}
    </>
  );
}
