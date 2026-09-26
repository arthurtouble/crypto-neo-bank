"use client";

import { useFundWallet } from "@privy-io/react-auth";
import { Check, Copy, CreditCard, LoaderCircle } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";
import { HOME_CHAIN } from "@/config/chains";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { AddFromWallet } from "./add-from-wallet";
import { useToast } from "./toast";

/**
 * Every way to add money to the Aura account, all on one screen: receive on
 * Base at the account address, move it from a connected wallet (bridged to
 * Base from other networks), or pay by card. Balances come from the chain;
 * nothing here records a deposit.
 */
export function DepositWorkspace() {
  const { address, ready } = useAuraWallet();
  const { fundWallet } = useFundWallet();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [paying, setPaying] = useState(false);
  const [slowSetup, setSlowSetup] = useState(false);

  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setSlowSetup(true), 15_000);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (!ready || !address) {
    return <section className="panel walletLoading" role="status"><LoaderCircle className="spin" size={20} /><div><strong>Setting up your account</strong>
      {slowSetup && <p>This is taking longer than usual. Refresh the page. If it keeps happening, contact support.</p>}</div></section>;
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address!);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy", "Select the address and copy it instead.");
    }
  }

  async function payByCard() {
    setPaying(true);
    try {
      // Privy's card flow needs a starting amount; the customer changes it there.
      await fundWallet({ address: address!, options: { chain: HOME_CHAIN, asset: "USDC", amount: "25", defaultFundingMethod: "card" } });
    } catch {
      toast.error("Card payment didn't finish", "You can try again, or use one of the other ways here.");
    } finally { setPaying(false); }
  }

  return <>
    <section className="panel" aria-labelledby="deposit-receive">
      <h2 id="deposit-receive">Receive on Base</h2>
      <p>Send USDC, ETH, or cbBTC on Base to your Aura account from any wallet or exchange.</p>
      <div className="receiveQr"><QRCodeSVG value={address} size={164} bgColor="transparent" fgColor="currentColor" level="M" aria-label="QR code of your Aura account address" role="img" /></div>
      <code className="addressBlock" data-testid="account-address">{address}</code>
      <button type="button" className="button secondary full" onClick={() => void copyAddress()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Copied" : "Copy address"}</button>
      <div className="modalRisk">Only send on Base. Money sent on another network won&apos;t show in Aura. To add from another network, use your wallet below.</div>
    </section>

    <section className="panel" aria-labelledby="deposit-wallet">
      <h2 id="deposit-wallet">From your wallet</h2>
      <p>Move money from a wallet you connected, like MetaMask. From another network, it&apos;s moved to Base as the same asset.</p>
      <AddFromWallet account={address} />
    </section>

    <section className="panel" aria-labelledby="deposit-card">
      <h2 id="deposit-card">Pay by card</h2>
      <p>Buy USDC with a debit or credit card. It arrives in your Aura account on Base.</p>
      <button type="button" className="button secondary full" disabled={paying} onClick={() => void payByCard()}>
        {paying ? <LoaderCircle className="spin" size={16} /> : <CreditCard size={16} />} Pay by card</button>
    </section>
  </>;
}
