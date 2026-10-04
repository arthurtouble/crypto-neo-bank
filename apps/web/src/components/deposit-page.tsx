"use client";

import { Building2, ChevronRight, CreditCard, LoaderCircle, QrCode, Wallet } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { HOME_CHAIN } from "@/config/supported-chains";
import { assetsFor } from "@/lib/assets/registry";
import { ADD_MONEY_WAYS, type AddMoneyWay } from "@/lib/deposits/ways";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { useWallet } from "@/lib/client/wallet-context";
import { shortAddress } from "@/lib/format";
import { AddFromWallet } from "./add-from-wallet";
import { BankDepositPanel } from "./bank-deposit-panel";
import { CopyButton } from "./copy-button";
import { MoneyPage } from "./money-page";
import { useToast } from "./toast";
import { LoadingState, Notice } from "./states";

/** Change B3: everything that shows in Aura when it arrives on Base, from the asset registry. */
const RECEIVABLE = assetsFor("hold", HOME_CHAIN.id);
const DEFAULT_RECEIVE = RECEIVABLE.find((asset) => asset.symbol === "USDC") ?? RECEIVABLE[0];
const EXAMPLE_ADDRESS = "0x000000000000000000000000000000000000e0a1";
const icons = { receive: QrCode, wallet: Wallet, card: CreditCard, bank: Building2 } as const;
const tabs = ADD_MONEY_WAYS.map((way) => ({ ...way, icon: icons[way.id] }));
type Tab = AddMoneyWay;

/** Guests see what each way does, with one way to sign in. */
function SignInToAdd({ onSignIn }: { onSignIn: () => void }) {
  return <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onSignIn}>Sign in to add money</button>;
}

function SettingUp() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 15_000);
    return () => window.clearTimeout(timer);
  }, []);
  return <LoadingState><div><strong>Setting up your account</strong>
    {slow && <p>This is taking longer than usual. Refresh the page. If it keeps happening, contact support.</p>}</div></LoadingState>;
}

/** The address in groups of four, so it's easy to check against what the other app shows. Copy and the QR code use it whole. */
function AddressGroups({ address }: { address: string }) {
  const groups = address.slice(2).match(/.{1,4}/g) ?? [];
  return <>{["0x" + (groups.shift() ?? ""), ...groups].map((group, index) => <span key={index}>{group}</span>)}</>;
}

/** A link for a step that isn't this page's: the payment page in Settings, or sign-in for a guest. */
function TagLink({ isExample, onSignIn }: { isExample: boolean; onSignIn: () => void }) {
  return <p className="mxHint">Want people to pay you? {isExample
    ? <button type="button" className="mxInlineLink" onClick={onSignIn}>Sign in to share your payment page</button>
    : <Link className="mxInlineLink" href="/app/settings#tag">Share your payment page</Link>}</p>;
}

function ReceivePanel({ address, isExample, onSignIn }: { address: string; isExample: boolean; onSignIn: () => void }) {
  const [assetId, setAssetId] = useState(DEFAULT_RECEIVE.id);
  const asset = RECEIVABLE.find((item) => item.id === assetId) ?? DEFAULT_RECEIVE;
  return <section className="mxPanel" aria-labelledby="deposit-receive">
    <div className="mxPanelHead"><h2 id="deposit-receive">Receive</h2>
      <p>Send to your Aura account from an exchange or another wallet.</p></div>
    <label className="mxField">What you&apos;re sending
      <select value={asset.id} onChange={(event) => setAssetId(event.target.value)} aria-describedby="deposit-receive-note">
        {RECEIVABLE.map((item) => <option key={item.id} value={item.id}>{item.symbol} · {item.name}</option>)}
      </select>
    </label>
    <div className="mxReceive">
      <div className="mxQr"><QRCodeSVG value={address} size={168} bgColor="transparent" fgColor="currentColor" level="M" aria-label="QR code of your Aura account address" role="img" /></div>
      <div className="mxReceiveAddress">
        <span className="mxLabel">{isExample ? "Example address" : "Your Aura address"}</span>
        <code className="mxAddress" title={address}>
          <span className="mxAddressFull" data-testid={isExample ? undefined : "account-address"}><AddressGroups address={address} /></span>
          <span className="mxAddressShort">{shortAddress(address)}</span>
        </code>
        <CopyButton value={address} label="Copy address" />
        <p className="mxHint">Your balance updates once the money arrives.</p>
      </div>
    </div>
    <Notice tone="warning"><span id="deposit-receive-note">Choose Base as the network when you send {asset.symbol}. Money sent on another network, or an asset not in this list, won&apos;t show in Aura. To add from another network, use From a wallet.</span></Notice>
    <TagLink isExample={isExample} onSignIn={onSignIn} />
  </section>;
}

/** Whether card purchases are open (`card_deposits`); Privy's own funding setting is what stops a purchase. */
function useCardOpen(enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ["deposit-methods"], queryFn: () => api<{ card: boolean }>("/api/deposits/methods"), enabled });
}

function CardPanel({ address, isExample, onSignIn }: { address: string | undefined; isExample: boolean; onSignIn: () => void }) {
  const { fundWallet } = useWallet();
  const methods = useCardOpen(!isExample);
  const toast = useToast();
  const [paying, setPaying] = useState(false);
  async function payByCard() {
    setPaying(true);
    try {
      // Privy's card flow needs a starting amount; the customer changes it there.
      await fundWallet({ address: address!, options: { chain: HOME_CHAIN, asset: "USDC", amount: "25", defaultFundingMethod: "card" } });
    } catch {
      toast.error("Card payment didn't finish", "You can try again, or use one of the other ways here.");
    } finally { setPaying(false); }
  }
  return <section className="mxPanel" aria-labelledby="deposit-card">
    <div className="mxPanelHead"><h2 id="deposit-card">Pay by card</h2>
      <p>Buy USDC with a debit or credit card. It arrives in your Aura account.</p></div>
    {/* Privy picks the card partner (MoonPay, Coinbase Onramp, or Stripe, as its dashboard allows) and names it in its own window. */}
    <p className="mxHint" data-testid="card-processor">Privy opens a checkout where its card partner charges your card. Before you pay, you see the
      partner&apos;s name, its fee, its limits, and how much USDC you get. Aura doesn&apos;t add a fee.</p>
    {isExample ? <SignInToAdd onSignIn={onSignIn} />
      : methods.isPending ? <LoadingState label="Checking card payments…" />
      : methods.isError ? <Notice tone="error" role="alert" onRetry={() => void methods.refetch()}>Card payments are unavailable right now.</Notice>
      : !methods.data.card ? <Notice tone="warning">Card payments aren&apos;t available right now. You can use one of the other ways here.</Notice>
      : <button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={paying || !address} onClick={() => void payByCard()}>
        {paying ? <LoaderCircle className="spin" aria-hidden="true" /> : <CreditCard aria-hidden="true" />} Pay by card</button>}
  </section>;
}

function initialTab(): Tab {
  const hash = window.location.hash.slice(1);
  return tabs.some((tab) => tab.id === hash) ? hash as Tab : "receive";
}

/**
 * Add money: every way to add money to the Aura account (journey J4): receive on Base at the account address, move it from a
 * connected wallet, pay by card, or a US bank transfer through Bridge. Tabs on desktop, rows on the phone. Balances
 * come from the chain; nothing here records a deposit.
 */
export function DepositPage() {
  const { authenticated, ready, login } = useAuth();
  const { address, ready: walletReady } = useAuraWallet();
  const isExample = ready && !authenticated;
  // Until Privy knows who this is, label the page as example data (so the first render, and the server's, is labelled)
  // but show nothing that looks like an account yet.
  const loading = !ready;
  const [tab, setTab] = useState<Tab>("receive");
  // A link can open one way directly (/app/deposit#bank); read after hydrating so the server render matches.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setTab(initialTab()));
    return () => cancelAnimationFrame(frame);
  }, []);
  const account = isExample ? EXAMPLE_ADDRESS : address;

  function choose(next: Tab) {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  const needsWallet = loading || (!isExample && (!walletReady || !address));
  return <MoneyPage title="Add money" guest={isExample || loading} onSignIn={login} ready={ready}>
    <div className="mxWaysLayout">
      <div className="mxTabs mxWays" role="tablist" aria-label="Ways to add money">
        {tabs.map(({ id, label, detail, icon: Icon }) => <button key={id} type="button" role="tab" id={`deposit-tab-${id}`} aria-controls={`deposit-panel-${id}`}
          aria-labelledby={`deposit-tab-${id}-label`} aria-describedby={`deposit-tab-${id}-detail`}
          aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => choose(id)}
          onKeyDown={(event) => {
            const index = tabs.findIndex((item) => item.id === tab);
            const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
            if (!step) return;
            event.preventDefault();
            const next = tabs[(index + step + tabs.length) % tabs.length].id;
            choose(next);
            document.getElementById(`deposit-tab-${next}`)?.focus();
          }}>
          <span className="mxTabIcon"><Icon aria-hidden="true" /></span>
          <span className="mxTabText"><strong id={`deposit-tab-${id}-label`}>{label}</strong><small id={`deposit-tab-${id}-detail`}>{detail}</small></span>
          <ChevronRight className="mxTabChevron" aria-hidden="true" />
        </button>)}
      </div>
      <div role="tabpanel" id={`deposit-panel-${tab}`} aria-labelledby={`deposit-tab-${tab}-label`} className="mxTabPanel">
        {tab === "receive" && (needsWallet || !account ? <SettingUp /> : <ReceivePanel address={account} isExample={isExample} onSignIn={login} />)}
        {tab === "wallet" && <section className="mxPanel" aria-labelledby="deposit-wallet">
          <div className="mxPanelHead"><h2 id="deposit-wallet">From your wallet</h2>
            <p>Move money from a wallet you connected, like MetaMask. From another network, it arrives as the same asset.</p></div>
          {isExample ? <SignInToAdd onSignIn={login} /> : needsWallet || !address ? <SettingUp /> : <AddFromWallet account={address} />}
        </section>}
        {tab === "card" && (needsWallet ? <SettingUp /> : <CardPanel address={account} isExample={isExample} onSignIn={login} />)}
        {tab === "bank" && (loading ? <SettingUp /> : isExample ? <section className="mxPanel" aria-labelledby="deposit-bank">
          <div className="mxPanelHead"><h2 id="deposit-bank">From your bank</h2>
            <p>Get US bank details. Money you send to them arrives as USDC in your Aura account.</p></div>
          <SignInToAdd onSignIn={login} />
        </section> : <BankDepositPanel />)}
      </div>
    </div>
  </MoneyPage>;
}
