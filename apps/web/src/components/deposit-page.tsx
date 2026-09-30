"use client";

import { useFundWallet, usePrivy } from "@privy-io/react-auth";
import { Building2, Check, ChevronRight, Copy, CreditCard, LoaderCircle, QrCode, Wallet } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { HOME_CHAIN } from "@/config/chains";
import { assetsFor } from "@/lib/assets/registry";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { AddFromWallet } from "./add-from-wallet";
import { BankDepositPanel } from "./bank-deposit-panel";
import { GuestBanner } from "./guest-banner";
import { useToast } from "./toast";

/** Change B3: everything that shows in Aura when it arrives on Base, from the asset registry. */
const RECEIVABLE = assetsFor("hold", HOME_CHAIN.id);
const EXAMPLE_ADDRESS = "0x000000000000000000000000000000000000e0a1";
const tabs = [
  { id: "receive", label: "Receive", detail: "From an exchange or another wallet", icon: QrCode },
  { id: "wallet", label: "From a wallet", detail: "Move money from a wallet you connected", icon: Wallet },
  { id: "card", label: "Card", detail: "Buy USDC with a debit or credit card", icon: CreditCard },
  { id: "bank", label: "Bank", detail: "US bank details, once Bridge verifies you", icon: Building2 }
] as const;
type Tab = (typeof tabs)[number]["id"];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

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
  return <div className="mxState" role="status"><LoaderCircle className="spin" aria-hidden="true" /><div><strong>Setting up your account</strong>
    {slow && <p>This is taking longer than usual. Refresh the page. If it keeps happening, contact support.</p>}</div></div>;
}

function ReceivePanel({ address, isExample }: { address: string; isExample: boolean }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy", "Select the address and copy it instead.");
    }
  }
  return <section className="mxPanel" aria-labelledby="deposit-receive">
    <div className="mxPanelHead"><h2 id="deposit-receive">Receive on Base</h2>
      <p>Send any asset listed below on Base to your Aura account, from any wallet or exchange.</p></div>
    <div className="mxReceive">
      <div className="mxQr"><QRCodeSVG value={address} size={168} bgColor="transparent" fgColor="currentColor" level="M" aria-label="QR code of your Aura account address" role="img" /></div>
      <div className="mxReceiveAddress">
        <span className="mxLabel">{isExample ? "Example address" : "Your account address on Base"}</span>
        <code className="mxAddress" data-testid={isExample ? undefined : "account-address"}>{address}</code>
        <button type="button" className="appButton" onClick={() => void copyAddress()}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? "Copied" : "Copy address"}</button>
      </div>
    </div>
    <ul className="mxAssetList" aria-label="Assets you can receive on Base">
      {RECEIVABLE.map((asset) => <li key={asset.id}><strong>{asset.symbol}</strong><small>{asset.name}</small></li>)}
    </ul>
    <p className="mxNote mxNoteWarning">Only send on Base. Money sent on another network, or a token not listed here, won&apos;t show in Aura. To add from another network, use From a wallet.</p>
  </section>;
}

function CardPanel({ address, isExample, onSignIn }: { address: string | undefined; isExample: boolean; onSignIn: () => void }) {
  const { fundWallet } = useFundWallet();
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
      <p>Buy USDC with a debit or credit card. It arrives in your Aura account on Base.</p></div>
    {isExample ? <SignInToAdd onSignIn={onSignIn} />
      : <button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={paying || !address} onClick={() => void payByCard()}>
        {paying ? <LoaderCircle className="spin" aria-hidden="true" /> : <CreditCard aria-hidden="true" />} Pay by card</button>}
  </section>;
}

function initialTab(): Tab {
  const hash = window.location.hash.slice(1);
  return tabs.some((tab) => tab.id === hash) ? hash as Tab : "receive";
}

/**
 * Every way to add money to the Aura account (journey J4): receive on Base at the account address, move it from a
 * connected wallet, pay by card, or a US bank transfer through Bridge. Tabs on desktop, rows on the phone. Balances
 * come from the chain; nothing here records a deposit.
 */
export function DepositPage() {
  const { authenticated, ready, login } = usePrivy();
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
  return <div className="mxPage">
    {(isExample || loading) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="mxHead"><h1>Deposit</h1></header>
    <div className="mxColumns">
      <div className="mxMain">
        <div className="mxTabs" role="tablist" aria-label="Ways to deposit">
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
          {tab === "receive" && (needsWallet || !account ? <SettingUp /> : <ReceivePanel address={account} isExample={isExample} />)}
          {tab === "wallet" && <section className="mxPanel" aria-labelledby="deposit-wallet">
            <div className="mxPanelHead"><h2 id="deposit-wallet">From your wallet</h2>
              <p>Move money from a wallet you connected, like MetaMask. From another network, it&apos;s moved to Base as the same asset.</p></div>
            {isExample ? <SignInToAdd onSignIn={login} /> : needsWallet || !address ? <SettingUp /> : <AddFromWallet account={address} />}
          </section>}
          {tab === "card" && (needsWallet ? <SettingUp /> : <CardPanel address={account} isExample={isExample} onSignIn={login} />)}
          {tab === "bank" && (loading ? <SettingUp /> : isExample ? <section className="mxPanel" aria-labelledby="deposit-bank">
            <div className="mxPanelHead"><h2 id="deposit-bank">Deposit from a bank</h2>
              <p>Bridge, our banking partner, verifies your identity, then gives you US bank details. Deposits arrive as USDC in your Aura account.</p></div>
            <SignInToAdd onSignIn={login} />
          </section> : <BankDepositPanel />)}
        </div>
      </div>
      <aside className="mxSide">
        <section className="mxCard" aria-label="Where it arrives">
          <h2>Where it arrives</h2>
          <dl className="mxSummary">
            <div><dt>Account</dt><dd className="mxMono">{account ? shortAddress(account) : "Setting up"}</dd></div>
            <div><dt>Network</dt><dd>Base</dd></div>
          </dl>
          <p className="mxHint">Your balance comes from the network, so it updates once the money arrives.</p>
        </section>
        <section className="mxCard" aria-labelledby="deposit-tag">
          <h2 id="deposit-tag">Get paid with your tag</h2>
          <p className="mxHint">Share a public payment page where people can pay you in crypto, and by bank transfer if you choose to show your bank details.</p>
          {isExample ? <button type="button" className="appButton" onClick={login}>Sign in to manage your tag</button>
            : <Link className="appButton" href="/app/settings#tag">Manage your tag</Link>}
        </section>
      </aside>
    </div>
  </div>;
}
