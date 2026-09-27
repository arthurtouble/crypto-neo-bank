"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { LoaderCircle, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { erc20Abi, formatUnits, isAddress, parseUnits } from "viem";
import { useBalance, useReadContracts } from "wagmi";
import { HOME_CHAIN } from "@/config/chains";
import { assetsFor, sendDestinations } from "@/lib/assets/registry";
import { ApiError, useApi } from "@/lib/client/api";
import { displayRawAmount } from "@/lib/swap/review-model";
import { useAction } from "@/lib/client/use-action";
import { MovePreviousAccount } from "./move-previous-account";
import type { RouteQuote } from "./swap-workspace";
import { useToast } from "./toast";
import { TransactionProgress } from "./transaction-progress";

/** What can be sent: the registry's "send" assets on Base. The server checks the same list and any pause. */
const SENDABLE = assetsFor("send", HOME_CHAIN.id);
const TOKENS = SENDABLE.filter((item) => item.address !== null);
type AssetSymbol = string;
type Modal = "send" | null;
type Recipient = { id: string; kind: "wallet" | "bank"; name: string; destination: string; detail: string; verified: boolean; recent?: boolean; availableAt?: string };

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

function quoteErrorText(error: unknown): string {
  if (error instanceof ApiError && error.code === "feature_unavailable") return "Sending to other networks isn't available right now.";
  if (error instanceof ApiError && error.code === "rate_limited") return "Too many quotes. Wait a minute and try again.";
  return error instanceof Error ? error.message : "We couldn't get a quote. Try again.";
}

function expired(quote: RouteQuote) {
  return Date.parse(quote.expiresAt) <= Date.now();
}

/** What the recipient doesn't get: the route's fees, in dollars, when LI.FI prices both sides. */
function feesUsd(quote: RouteQuote): string | null {
  const from = Number(quote.fromAmountUsd), to = Number(quote.toAmountUsd);
  const fees = quote.fromAmountUsd && quote.toAmountUsd && Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, from - to) : quote.providerFeeUsd;
  return fees === null ? null : fees.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
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
  // Where it arrives. Anything but Base goes through a LI.FI route, with its fees taken from the amount.
  const [network, setNetwork] = useState<number>(HOME_CHAIN.id);
  const [quote, setQuote] = useState<RouteQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  // A new address can be saved as a recipient, with a name, when it's sent to.
  const [saveRecipient, setSaveRecipient] = useState(false);
  const [nickname, setNickname] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // Nothing is prepared until the customer has seen exactly what will be sent, and to whom.
  const [reviewing, setReviewing] = useState(false);
  const [slowSetup, setSlowSetup] = useState(false);
  const { user } = usePrivy();
  const toast = useToast();
  const queryClient = useQueryClient();
  // Wallets the customer linked to their login, such as MetaMask. Never the Privy signer, which isn't theirs to send to.
  const ownWallets = (user?.linkedAccounts ?? []).flatMap((account) => account.type === "wallet" && account.chainType === "ethereum"
    && !account.walletClientType?.startsWith("privy") && isAddress(account.address, { strict: false }) ? [account.address.toLowerCase()] : []);
  // useAction refreshes every query (balances included) when an action settles.
  const transfer = useAction({ label: "Transfer" });
  const { address, ready } = transfer.wallet;
  const sending = transfer.busy;
  // Once it has left the account, it's sent: the customer can close this or start another. Transactions tracks the rest.
  const handedOff = transfer.action?.status === "settling";
  const inFlight = (transfer.phase !== "idle" && transfer.phase !== "done" && !handedOff) || transfer.outcomeUnknown;
  const eth = useBalance({ address, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const tokens = useReadContracts({ contracts: TOKENS.map((item) => ({ address: item.address!, abi: erc20Abi, functionName: "balanceOf" as const,
    args: [address!] as const, chainId: HOME_CHAIN.id })), query: { enabled: Boolean(address) } });
  const recipients = useQuery<{ recipients: Recipient[] }>({
    queryKey: ["recipients", address],
    queryFn: () => api("/api/recipients"),
    enabled: Boolean(address && modal === "send")
  });
  // Saved recipients include ones still in their waiting period; sending to them may wait until it ends.
  const savedRecipients = recipients.data?.recipients.filter((item) => item.kind === "wallet" && !item.recent) ?? [];
  const recentRecipients = recipients.data?.recipients.filter((item) => item.kind === "wallet" && item.recent).slice(0, 3) ?? [];

  const rows = SENDABLE.map((item) => {
    const index = TOKENS.indexOf(item);
    const value = index < 0 ? eth.data?.value : tokens.data?.[index]?.status === "success" ? tokens.data[index].result as bigint : undefined;
    return { ...item, value, source: "Aura Wallet", pending: index < 0 ? eth.isPending : tokens.isPending };
  });

  function openSend(symbol: AssetSymbol = "USDC") {
    if (sending) return;
    // Keep an unsettled or uncertain transfer on screen instead of starting a new one.
    if ((transfer.phase === "tracking" && !handedOff) || transfer.outcomeUnknown) { setModal("send"); return; }
    transfer.reset();
    setAsset(symbol);
    setRecipient("");
    setAmount("");
    setNetwork(HOME_CHAIN.id);
    setQuote(null);
    setSaveRecipient(false);
    setNickname("");
    setFormError(null);
    setReviewing(false);
    setModal("send");
  }

  async function verifyTagRecipient() {
    if (!requestedTag) return;
    const response = await fetch(`/api/aura-tags/${encodeURIComponent(requestedTag)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("This Aura tag is no longer available. Find the recipient again.");
    const tag = await response.json() as { crypto: { address: string } };
    if (tag.crypto.address.toLowerCase() !== recipient.toLowerCase()) throw new Error("The Aura tag address changed. Find the recipient again before sending.");
  }

  const selected = rows.find((row) => row.symbol === asset) ?? rows[0];
  const destinations = sendDestinations(selected.id);
  const destination = destinations.find((item) => item.chainId === network) ?? destinations[0];
  const crossChain = destination.chainId !== HOME_CHAIN.id;
  const saved = savedRecipients.find((item) => item.destination.toLowerCase() === recipient.toLowerCase());
  const tagged = Boolean(requestedTag && recipient.toLowerCase() === requestedRecipient.toLowerCase());
  const ownWallet = ownWallets.some((wallet) => wallet === recipient.toLowerCase());
  const recipientName = tagged ? `@${requestedTag}` : ownWallet ? "Your wallet" : saved?.name ?? null;
  const validRecipient = isAddress(recipient, { strict: false }) && recipient.toLowerCase() !== address?.toLowerCase();
  // Only a new address can be saved from here; saved ones are managed in Settings.
  const canSave = validRecipient && !saved && !ownWallet && !tagged;
  const waitingUntil = saved && !saved.verified && saved.availableAt ? new Date(saved.availableAt) : null;

  function chooseAsset(symbol: AssetSymbol) {
    setAsset(symbol);
    const next = SENDABLE.find((item) => item.symbol === symbol);
    if (next && !sendDestinations(next.id).some((item) => item.chainId === network)) setNetwork(HOME_CHAIN.id);
  }

  async function getQuote(): Promise<RouteQuote | null> {
    setQuoting(true);
    try {
      const query = new URLSearchParams({ from: selected.id, to: destination.asset.id, amount, recipient: recipient.toLowerCase() });
      const body = await api<{ quote: RouteQuote }>(`/api/routes/quote?${query}`);
      setQuote(body.quote);
      return body.quote;
    } catch (caught) {
      toast.error("No quote", quoteErrorText(caught));
      return null;
    } finally { setQuoting(false); }
  }

  async function review(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!address) return setFormError("Your wallet isn't ready yet.");
    if (!isAddress(recipient, { strict: false })) return setFormError("Enter a valid address.");
    if (recipient.toLowerCase() === address.toLowerCase()) return setFormError("This is your own Aura address.");
    if (!/^\d*\.?\d+$/.test(amount) || Number(amount) <= 0) return setFormError("Enter an amount greater than zero.");
    let raw: bigint;
    try { raw = parseUnits(amount, selected.decimals); } catch { return setFormError(`Use at most ${selected.decimals} decimal places.`); }
    if ((amount.split(".")[1]?.length ?? 0) > selected.decimals) return setFormError(`Use at most ${selected.decimals} decimal places.`);
    if (selected.value !== undefined && raw > selected.value) return setFormError(`That's more ${asset} than you have.`);
    if (canSave && saveRecipient && !nickname.trim()) return setFormError("Give this recipient a name.");
    setQuote(null);
    if (crossChain && !await getQuote()) return;
    setReviewing(true);
  }

  async function saveNewRecipient(): Promise<boolean> {
    if (!canSave || !saveRecipient) return true;
    try {
      await api("/api/recipients", { method: "POST", json: { kind: "wallet", address: recipient, name: nickname.trim() } });
      await queryClient.invalidateQueries({ queryKey: ["recipients"] });
      toast.success("Recipient saved", `${nickname.trim()} is in your saved recipients.`);
      setSaveRecipient(false);
      return true;
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : "We couldn't save this recipient.");
      return false;
    }
  }

  async function confirmSend() {
    setFormError(null);
    try { await verifyTagRecipient(); }
    catch (reason) { setReviewing(false); return setFormError(reason instanceof Error ? reason.message : "Find the recipient again."); }
    if (!await saveNewRecipient()) return;
    if (!crossChain) return void await transfer.run({ kind: "transfer", assetId: assetId(asset), amount, to: recipient as `0x${string}` });
    // A quote lasts a short time. If it ran out, show the new one before anything is sent.
    if (!quote || expired(quote)) {
      if (await getQuote()) setFormError("The quote expired, so we got a new one. Check the amounts, then confirm.");
      return;
    }
    await transfer.run({ kind: "route", quoteId: quote.id });
  }

  function useMax() {
    if (selected.value !== undefined) setAmount(formatUnits(selected.value, selected.decimals));
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
          <form onSubmit={(event) => void review(event)}>
            <h2 id="wallet-modal-title">{reviewing ? "Review" : "Send"}</h2>
            {!reviewing ? <>
              <label className="fieldLabel">Asset<select value={asset} disabled={inFlight} onChange={(event) => chooseAsset(event.target.value as AssetSymbol)}>{SENDABLE.map((item) => <option key={item.id}>{item.symbol}</option>)}</select></label>
              <label className="fieldLabel">Amount<input inputMode="decimal" placeholder="0.00" value={amount} disabled={inFlight} onChange={(event) => setAmount(event.target.value.trim())} /></label>
              <p className="authorityFootnote">{selected.value === undefined ? "Balance unavailable" : `${amountText(selected.value, selected.decimals)} ${asset} available`}
                {selected.value !== undefined && selected.value > 0n && <> · <button type="button" className="textLink" onClick={useMax}>Max</button></>}</p>
              <label className="fieldLabel">Network<select value={destination.chainId} disabled={inFlight} onChange={(event) => setNetwork(Number(event.target.value))}>{destinations.map((item) => <option key={item.chainId} value={item.chainId}>{item.name}</option>)}</select></label>
              {crossChain && <p className="authorityFootnote">Sent through LI.FI. Its fees come out of the amount, so the recipient gets a little less. You&apos;ll see how much before you confirm.</p>}
              {(savedRecipients.length > 0 || recentRecipients.length > 0 || ownWallets.length > 0) && <div className="recipientChoices" role="group" aria-label="Recipients">
                {savedRecipients.map((item) => <button type="button" key={item.id} aria-pressed={item.destination.toLowerCase() === recipient.toLowerCase()} disabled={inFlight} onClick={() => setRecipient(item.destination)}>
                  <strong>{item.name}</strong><small>{item.detail}{!item.verified && " · waiting period"}</small></button>)}
                {ownWallets.map((wallet) => <button type="button" key={wallet} aria-pressed={wallet === recipient.toLowerCase()} disabled={inFlight} onClick={() => setRecipient(wallet)}>
                  <strong>My wallet</strong><small>{shortAddress(wallet)}</small></button>)}
                {recentRecipients.map((item) => <button type="button" key={item.id} aria-pressed={item.destination.toLowerCase() === recipient.toLowerCase()} disabled={inFlight} onClick={() => setRecipient(item.destination)}>
                  <strong>Recent</strong><small>{item.detail}</small></button>)}
              </div>}
              <label className="fieldLabel">To<input autoComplete="off" spellCheck={false} placeholder="0x…" value={recipient} disabled={inFlight} onChange={(event) => { setRecipient(event.target.value.trim()); setSaveRecipient(false); }} /></label>
              {validRecipient && <p className="authorityFootnote" data-testid="recipient-status">
                {tagged ? `Aura tag @${requestedTag}` : ownWallet ? "Your wallet" : saved ? `Saved recipient: ${saved.name}${waitingUntil ? `. In its waiting period until ${waitingUntil.toLocaleString()}.` : ""}` : "New address. Check it carefully."}</p>}
              {canSave && <label className="checkRow"><input type="checkbox" checked={saveRecipient} disabled={inFlight} onChange={(event) => setSaveRecipient(event.target.checked)} /> Save as a recipient</label>}
              {canSave && saveRecipient && <label className="fieldLabel">Name<input autoComplete="off" maxLength={48} placeholder="For example, Sam" value={nickname} disabled={inFlight} onChange={(event) => setNickname(event.target.value)} /></label>}
              {formError && <p className="formError" role="alert">{formError}</p>}
              <button className="button primary full" disabled={inFlight || quoting}>{quoting ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} {quoting ? "Getting a quote" : "Review"}</button>
            </> : <>
              <div className="transactionSummary" data-testid="send-review">
                <span>Send<strong>{amount} {asset}</strong></span>
                <span>To<strong>{recipientName ? `${recipientName} · ${shortAddress(recipient)}` : recipient}</strong></span>
                <span>Network<strong>{destination.name}</strong></span>
                {crossChain && quote && <>
                  <span>They receive<strong>About {displayRawAmount(quote.toAmountRaw, quote.to.decimals)} {quote.to.symbol}</strong></span>
                  <span>At least<strong>{displayRawAmount(quote.toAmountMinRaw, quote.to.decimals)} {quote.to.symbol}</strong></span>
                  <span>Fees<strong>{feesUsd(quote) ? `About ${feesUsd(quote)}, taken from the amount` : "Taken from the amount"}</strong></span>
                </>}
                <span>{crossChain ? "Network fee on Base" : "Network fee"}<strong>Paid by Aura</strong></span>
                {canSave && saveRecipient && <span>Save as<strong>{nickname.trim()}</strong></span>}
              </div>
              <p className="authorityFootnote">{crossChain ? `Transfers can't be reversed. Check that the recipient can receive ${asset} on ${destination.name}.` : "Transfers can't be reversed. Check the address before you confirm."}</p>
              {formError && <p className="formError" role="alert">{formError}</p>}
              <TransactionProgress label="Transfer" phase={transfer.phase} action={transfer.action} outcomeUnknown={transfer.outcomeUnknown} />
              {transfer.phase === "done" || handedOff
                ? <button type="button" className="button primary full" onClick={() => { transfer.reset(); setAmount(""); setQuote(null); setReviewing(false); }}><Send size={16} /> New transfer</button>
                : <>
                  <button type="button" className="button primary full" disabled={inFlight || quoting} onClick={() => void confirmSend()}>{sending ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{transfer.outcomeUnknown ? "Check Transactions first" : transfer.phase === "tracking" ? "Sending" : transfer.phase === "preparing" ? "Checking" : sending ? "Confirm with your passkey" : "Confirm and send"}</button>
                  {!inFlight && <button type="button" className="button secondary full" onClick={() => setReviewing(false)}>Edit</button>}
                </>}
            </>}
          </form>
        </section>
      </div>}
    </>
  );
}
