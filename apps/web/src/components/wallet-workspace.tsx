"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/client/auth";
import { History, LoaderCircle, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { formatUnits, parseUnits } from "@/lib/format/units";
import { HOME_CHAIN } from "@/config/supported-chains";
import { assetsFor, networkName, sendDestinations } from "@/lib/assets/registry";
import { ApiError, useApi } from "@/lib/client/api";
import { formatDateTime, formatToken, formatUsd, shortAddress } from "@/lib/format";
import { displayRawAmount } from "@/lib/swap/review-model";
import { useAction } from "@/lib/client/use-action";
import { useNativeBalance, useTokenBalances } from "@/lib/client/wallet-context";
import { MovePreviousAccount } from "./move-previous-account";
import type { RouteQuote } from "./swap-workspace";
import { useToast } from "./toast";
import { TransactionProgress } from "./transaction-progress";
import { LoadingState, Notice } from "./states";

/** What can be sent: the registry's "send" assets, on the network where the account holds each (Base, or Ethereum for Tether Gold). The server checks the same list and any pause. */
const SENDABLE = assetsFor("send");
const TOKENS = SENDABLE.filter((item) => item.address !== null);
const TOKEN_READS = TOKENS.map((item) => ({ token: item.address!, chainId: item.chainId }));
type AssetSymbol = string;
/** An address in groups of four, five groups a line, checksummed so its letters read as they were given. */
function addressChunks(address: string) {
  const hex = getAddress(address).slice(2);
  const groups = hex.match(/.{4}/g) ?? [];
  groups[0] = `0x${groups[0]}`;
  return [groups.slice(0, 5).join(" "), groups.slice(5).join(" ")];
}

type Recipient = { id: string; kind: "wallet" | "bank"; name: string; destination: string; detail: string; verified: boolean; recent?: boolean; availableAt?: string };

function amountText(value: bigint | undefined, decimals: number) {
  if (value === undefined) return "—";
  return formatToken(Number(formatUnits(value, decimals)));
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

/** An Aura tag typed in the To field: "@sam" or "sam", lower case. Anything that could be an address isn't a tag. */
function typedTag(text: string): string | null {
  const tag = text.trim().replace(/^@/, "").toLowerCase();
  return text.trim().startsWith("@") || (/^[a-z0-9_-]{3,32}$/.test(tag) && !tag.startsWith("0x")) ? tag : null;
}

/** What the recipient doesn't get: the fees, in dollars, when LI.FI prices both sides. */
function feesUsd(quote: RouteQuote): string | null {
  const from = Number(quote.fromAmountUsd), to = Number(quote.toAmountUsd);
  const fees = quote.fromAmountUsd && quote.toAmountUsd && Number.isFinite(from) && Number.isFinite(to) ? Math.max(0, from - to) : quote.providerFeeUsd;
  return fees === null ? null : formatUsd(fees);
}

/** Send crypto from the Aura account (journey J5): amount and asset, then who, then its own review step and the passkey. */
export function WalletWorkspace() {
  const searchParams = useSearchParams();
  const api = useApi();
  const requestedRecipient = searchParams.get("sendTo") ?? "";
  const requestedTag = searchParams.get("tag")?.toLowerCase() ?? null;
  const requestedAsset = searchParams.get("asset");
  const initialAsset = SENDABLE.some((item) => item.symbol === requestedAsset) ? requestedAsset! : "USDC";
  const [asset, setAsset] = useState<AssetSymbol>(initialAsset);
  const [recipient, setRecipient] = useState(isAddress(requestedRecipient) ? requestedRecipient : "");
  // The To field takes an address or an Aura tag. A tag becomes an address when Aura finds it (on Review); a payment
  // page link arrives with both.
  const [tag, setTag] = useState<string | null>(requestedTag && isAddress(requestedRecipient) ? requestedTag : null);
  const [toText, setToText] = useState(tag ? `@${tag}` : recipient);
  const [finding, setFinding] = useState(false);
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
  // Change B2: an address never used from this account is checked first, in chunks, before the review.
  const [checking, setChecking] = useState(false);
  const [checkedAddress, setCheckedAddress] = useState<string | null>(null);
  const [slowSetup, setSlowSetup] = useState(false);
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  // Wallets the customer linked to their login, such as MetaMask. Never the Privy signer, which isn't theirs to send to.
  const ownWallets = (user?.linkedAccounts ?? []).flatMap((account) => account.type === "wallet" && account.chainType === "ethereum"
    && !account.walletClientType?.startsWith("privy") && isAddress(account.address, { strict: false }) ? [account.address.toLowerCase()] : []);
  // useAction refreshes every query (balances included) when an action settles.
  const transfer = useAction({ label: "Transfer", inlineRefusals: true });
  const { address, ready } = transfer.wallet;
  const sending = transfer.busy;
  // Once it has left the account, it's sent: the customer can close this or start another. Transactions tracks the rest.
  const handedOff = transfer.action?.status === "settling";
  const inFlight = (transfer.phase !== "idle" && transfer.phase !== "done" && !handedOff) || transfer.outcomeUnknown;
  const eth = useNativeBalance(address, HOME_CHAIN.id);
  const tokens = useTokenBalances(TOKEN_READS, address);
  const recipients = useQuery<{ recipients: Recipient[] }>({
    queryKey: ["recipients", address],
    queryFn: () => api("/api/recipients"),
    enabled: Boolean(address)
  });
  // Saved recipients include ones still in their waiting period; sending to them may wait until it ends.
  const savedRecipients = recipients.data?.recipients.filter((item) => item.kind === "wallet" && !item.recent) ?? [];
  const recentRecipients = recipients.data?.recipients.filter((item) => item.kind === "wallet" && item.recent).slice(0, 3) ?? [];

  const rows = SENDABLE.map((item) => {
    const index = TOKENS.indexOf(item);
    const value = index < 0 ? eth.data : tokens.data?.[index];
    return { ...item, value, source: `Aura account on ${networkName(item.chainId)}`, pending: index < 0 ? eth.isPending : tokens.isPending };
  });

  async function tagAddress(name: string): Promise<string | null> {
    const response = await fetch(`/api/aura-tags/${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!response.ok) return null;
    return ((await response.json()) as { crypto: { address: string } }).crypto.address;
  }

  async function verifyTagRecipient() {
    if (!tag) return;
    const address = await tagAddress(tag);
    if (!address) throw new Error(`@${tag} is no longer available. Check the tag and try again.`);
    if (address.toLowerCase() !== recipient.toLowerCase()) throw new Error(`@${tag} now points to a different address. Review it again before sending.`);
  }

  const tagLookup = useQuery<string>({
    queryKey: ["aura-tag-address", tag],
    queryFn: async () => {
      const address = await tagAddress(tag!);
      if (!address) throw new Error("tag_unavailable");
      return address;
    },
    enabled: Boolean(tag) && isAddress(recipient),
    retry: false
  });

  const selected = rows.find((row) => row.symbol === asset) ?? rows[0];
  const destinations = sendDestinations(selected.id);
  const destination = destinations.find((item) => item.chainId === network) ?? destinations[0];
  // Sent from where the account holds it; anywhere else goes through a route.
  const crossChain = destination.chainId !== selected.chainId;
  const saved = savedRecipients.find((item) => item.destination.toLowerCase() === recipient.toLowerCase());
  // A tag names the recipient only once Aura says it resolves to this very address.
  const tagged = Boolean(tag && tagLookup.data && tagLookup.data.toLowerCase() === recipient.toLowerCase());
  const ownWallet = ownWallets.some((wallet) => wallet === recipient.toLowerCase());
  const recipientName = tagged ? `@${tag}` : ownWallet ? "Your wallet" : saved?.name ?? null;
  const validRecipient = isAddress(recipient, { strict: false }) && recipient.toLowerCase() !== address?.toLowerCase();
  // Only a new address can be saved from here; saved ones are managed in Settings.
  const canSave = validRecipient && !saved && !ownWallet && !tagged;
  const waitingUntil = saved && !saved.verified && saved.availableAt ? new Date(saved.availableAt) : null;
  // Saved and recent recipients have been used from this account; own wallets are the customer's; a tag's address comes
  // from Aura and is checked again before signing. Anything else is a first-time address. If the list can't be read, it counts as new.
  const usedBefore = recipients.data?.recipients.some((item) => item.kind === "wallet" && item.destination.toLowerCase() === recipient.toLowerCase()) ?? false;
  const firstTime = validRecipient && !usedBefore && !ownWallet && !tagged;
  // Once checked, the Check step stays in the steps, even after the recipient is saved and so no longer new.
  const showCheck = firstTime || (validRecipient && checkedAddress === recipient.toLowerCase());

  function chooseRecipient(address: string) {
    setRecipient(address); setToText(address); setTag(null); setSaveRecipient(false); setFormError(null);
  }

  function typeRecipient(text: string) {
    const value = text.trim();
    setToText(value); setTag(null); setSaveRecipient(false); setFormError(null);
    setRecipient(isAddress(value, { strict: false }) ? value : "");
  }

  function chooseAsset(symbol: AssetSymbol) {
    setAsset(symbol);
    setFormError(null);
    const next = SENDABLE.find((item) => item.symbol === symbol);
    if (next && !sendDestinations(next.id).some((item) => item.chainId === network)) setNetwork(next.chainId);
  }

  async function getQuote(to = recipient): Promise<RouteQuote | null> {
    setQuoting(true);
    try {
      const query = new URLSearchParams({ from: selected.id, to: destination.asset.id, amount, recipient: to.toLowerCase() });
      const body = await api<{ quote: RouteQuote }>(`/api/routes/quote?${query}`);
      setQuote(body.quote);
      return body.quote;
    } catch (caught) {
      setFormError(quoteErrorText(caught));
      return null;
    } finally { setQuoting(false); }
  }

  async function review(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!address) return setFormError("Your wallet isn't ready yet.");
    let to = recipient;
    let isTag = tagged;
    const typed = !isAddress(toText, { strict: false }) ? typedTag(toText) : null;
    if (typed && !tagged) {
      setFinding(true);
      const found = await tagAddress(typed).catch(() => null);
      setFinding(false);
      if (!found) return setFormError(`We couldn't find @${typed}. Check the tag, or enter an address.`);
      queryClient.setQueryData(["aura-tag-address", typed], found);
      setRecipient(found); setTag(typed); setToText(`@${typed}`);
      to = found; isTag = true;
    }
    if (!isAddress(to, { strict: false })) return setFormError("Enter a valid address or Aura tag.");
    if (to.toLowerCase() === address.toLowerCase()) return setFormError("This is your own Aura address.");
    if (!/^\d*\.?\d+$/.test(amount) || Number(amount) <= 0) return setFormError("Enter an amount greater than zero.");
    let raw: bigint;
    try { raw = parseUnits(amount, selected.decimals); } catch { return setFormError(`Use at most ${selected.decimals} decimal places.`); }
    if ((amount.split(".")[1]?.length ?? 0) > selected.decimals) return setFormError(`Use at most ${selected.decimals} decimal places.`);
    if (selected.value !== undefined && raw > selected.value) return setFormError(`That's more ${asset} than you have.`);
    if (canSave && saveRecipient && !isTag && !nickname.trim()) return setFormError("Give this recipient a name.");
    if (firstTime && !isTag && checkedAddress !== to.toLowerCase()) return setChecking(true);
    await toReview(to);
  }

  async function toReview(to = recipient) {
    setQuote(null);
    // A failed quote goes back to the form, where its reason shows.
    if (crossChain && !await getQuote(to)) return setChecking(false);
    setReviewing(true);
  }

  async function addressCorrect() {
    setCheckedAddress(recipient.toLowerCase());
    setChecking(false);
    await toReview();
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
    return <LoadingState><div><strong>Setting up your account</strong>
      {slowSetup && <p>This is taking longer than usual. Refresh the page. If it keeps happening, contact support.</p>}
      {inFlight && <p role="alert">A transfer may be pending. Check Transactions before you try again.</p>}</div></LoadingState>;
  }

  const done = transfer.phase === "done" || handedOff;
  // A refusal before anything was sent (a limit, a switch, a paused asset) stays next to the button, not only in a toast.
  const refusal = reviewing && transfer.phase === "idle" && !transfer.outcomeUnknown ? transfer.error : null;
  return (
    <>
      <MovePreviousAccount />
      <div className="mxSingle">
          <section className="mxPanel" aria-labelledby="send-crypto-title">
            <div className="mxPanelHead mxPanelHeadRow"><h2 id="send-crypto-title">Send crypto</h2>
              <ol className="mxSteps" aria-label="Send steps"><li aria-current={!reviewing && !checking ? "step" : undefined}>Details</li>
                {showCheck && <li aria-current={checking ? "step" : undefined}>Check</li>}<li aria-current={reviewing ? "step" : undefined}>Review</li></ol></div>
            <form className="mxForm" onSubmit={(event) => void review(event)}>
              {checking && !reviewing ? <section className="mxForm" aria-labelledby="address-check-title">
                <h3 id="address-check-title" className="mxCheckTitle">You haven&apos;t sent to this address before</h3>
                <p className="mxAddressChunks" data-testid="address-chunks">{addressChunks(recipient).map((line) => <span key={line}>{line}</span>)}</p>
                <dl className="mxSummary"><div><dt>Network</dt><dd>{destination.name}</dd></div><div><dt>You send</dt><dd>{amount} {asset}</dd></div></dl>
                <p className="mxHint">Check it against the address you were given. For a large amount, send a small test first.</p>
                <div className="mxActions mxActionsStack">
                  <button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={quoting} onClick={() => void addressCorrect()}>{quoting ? <LoaderCircle className="spin" aria-hidden="true" /> : null}{quoting ? "Getting a quote" : "It's correct"}</button>
                  <button type="button" className="appButton appButtonLarge" disabled={quoting} onClick={() => setChecking(false)}>Edit</button>
                </div>
              </section> : !reviewing ? <>
                <div className="mxAmountRow">
                  <label className="mxField mxAmountField">Amount<input className="mxAmountInput" inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} disabled={inFlight} onChange={(event) => { setAmount(event.target.value.trim()); setFormError(null); }} /></label>
                  <label className="mxField">Asset<select value={asset} disabled={inFlight} onChange={(event) => chooseAsset(event.target.value as AssetSymbol)}>{SENDABLE.map((item) => <option key={item.id}>{item.symbol}</option>)}</select></label>
                </div>
                <p className="mxHint">{selected.value === undefined ? "Balance unavailable" : `${amountText(selected.value, selected.decimals)} ${asset} available`}
                  {selected.value !== undefined && selected.value > 0n && <> · <button type="button" className="appTextButton mxInlineButton" onClick={useMax}>Max</button></>}</p>
                <label className="mxField">Network<select value={destination.chainId} disabled={inFlight} onChange={(event) => { setNetwork(Number(event.target.value)); setFormError(null); }}>{destinations.map((item) => <option key={item.chainId} value={item.chainId}>{item.name}</option>)}</select></label>
                {crossChain && <Notice>Sending to another network has a small fee, taken from the amount, so the recipient gets a little less. You&apos;ll see how much before you confirm.</Notice>}
                {(savedRecipients.length > 0 || recentRecipients.length > 0 || ownWallets.length > 0) && <div className="mxFaces" role="group" aria-label="Recipients">
                  {savedRecipients.map((item) => <button type="button" key={item.id} aria-pressed={item.destination.toLowerCase() === recipient.toLowerCase()} disabled={inFlight} onClick={() => chooseRecipient(item.destination)}>
                    <span className="mxFace" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span><strong>{item.name}</strong><small>{shortAddress(item.destination)}</small></button>)}
                  {ownWallets.map((wallet) => <button type="button" key={wallet} aria-pressed={wallet === recipient.toLowerCase()} disabled={inFlight} onClick={() => chooseRecipient(wallet)}>
                    <span className="mxFace" aria-hidden="true">W</span><strong>My wallet</strong><small>{shortAddress(wallet)}</small></button>)}
                  {recentRecipients.map((item) => <button type="button" key={item.id} aria-pressed={item.destination.toLowerCase() === recipient.toLowerCase()} disabled={inFlight} onClick={() => chooseRecipient(item.destination)}>
                    <span className="mxFace" aria-hidden="true"><History /></span><strong>{shortAddress(item.destination)}</strong><small>Recent</small></button>)}
                </div>}
                <div className="mxFieldGroup">
                  <label className="mxField">To<input className="mxMonoInput" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="0x… or @tag" value={toText} disabled={inFlight} onChange={(event) => typeRecipient(event.target.value)} /></label>
                  {validRecipient ? <p className="mxHint" data-testid="recipient-status">
                    {tagged ? `Aura tag @${tag} · ${shortAddress(recipient)}` : ownWallet ? "Your wallet" : saved ? `Saved recipient: ${saved.name}${waitingUntil ? `. In its waiting period until ${formatDateTime(waitingUntil)}.` : ""}` : "New address. Check it carefully."}</p>
                    : typedTag(toText) && <p className="mxHint" data-testid="recipient-status">Aura tag. We&apos;ll find it when you review.</p>}
                </div>
                {canSave && !typedTag(toText) && <label className="mxCheck"><input type="checkbox" checked={saveRecipient} disabled={inFlight} onChange={(event) => setSaveRecipient(event.target.checked)} /> Save as a recipient</label>}
                {canSave && saveRecipient && <label className="mxField">Name<input autoComplete="off" maxLength={48} placeholder="For example, Sam" value={nickname} disabled={inFlight} onChange={(event) => { setNickname(event.target.value); setFormError(null); }} /></label>}
                {formError && <p className="mxFieldError" role="alert">{formError}</p>}
                <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={inFlight || quoting || finding}>{quoting || finding ? <LoaderCircle className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />} {finding ? "Finding recipient" : quoting ? "Getting a quote" : "Review"}</button>
              </> : <>
                <dl className="mxSummary" data-testid="send-review">
                  <div><dt>Send</dt><dd>{amount} {asset}</dd></div>
                  <div><dt>To</dt><dd>{recipientName ? `${recipientName} · ${shortAddress(recipient)}`
                    : <span className="mxAddress" title={recipient}><span className="mxAddressFull">{addressChunks(recipient).map((line) => <span key={line}>{line}</span>)}</span>
                      <span className="mxAddressShort">{shortAddress(recipient)}</span></span>}</dd></div>
                  <div><dt>Network</dt><dd>{destination.name}</dd></div>
                  {crossChain && quote && <>
                    <div><dt>They receive</dt><dd>About {displayRawAmount(quote.toAmountRaw, quote.to.decimals)} {quote.to.symbol}</dd></div>
                    <div><dt>At least</dt><dd>{displayRawAmount(quote.toAmountMinRaw, quote.to.decimals)} {quote.to.symbol}</dd></div>
                    <div><dt>Fees</dt><dd>{feesUsd(quote) ? `About ${feesUsd(quote)}, taken from the amount` : "Taken from the amount"}</dd></div>
                  </>}
                  <div><dt>Network fee</dt><dd className="mxPositive">Paid by Aura</dd></div>
                  {canSave && saveRecipient && <div><dt>Save as</dt><dd>{nickname.trim()}</dd></div>}
                </dl>
                <Notice tone="warning">{crossChain ? `Transfers can't be reversed. Check that the recipient can receive ${asset} on ${destination.name}.` : "Transfers can't be reversed. Check the address before you confirm."}</Notice>
                {formError && <p className="mxFieldError" role="alert">{formError}</p>}
                {!formError && refusal && <p className="mxFieldError" role="alert">{/nothing was sent/i.test(refusal) ? refusal : `Transfer not sent. ${refusal}`}</p>}
                <TransactionProgress label="Transfer" phase={transfer.phase} action={transfer.action} outcomeUnknown={transfer.outcomeUnknown} />
                {done
                  ? <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => { transfer.reset(); setAmount(""); setQuote(null); setReviewing(false); setChecking(false); setCheckedAddress(null); }}><Send aria-hidden="true" /> New transfer</button>
                  : <div className="mxActions mxActionsStack">
                    <button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={inFlight || quoting} onClick={() => void confirmSend()}>{sending ? <LoaderCircle className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}{transfer.outcomeUnknown ? "Check Transactions first" : transfer.phase === "tracking" ? "Sending" : transfer.phase === "preparing" ? "Checking" : sending ? "Confirm with your passkey" : "Confirm and send"}</button>
                    {!inFlight && <button type="button" className="appButton appButtonLarge" onClick={() => { transfer.reset(); setReviewing(false); setChecking(false); }}>Edit</button>}
                  </div>}
              </>}
            </form>
          </section>
      </div>
    </>
  );
}
