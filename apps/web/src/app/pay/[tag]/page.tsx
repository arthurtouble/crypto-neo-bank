import type { Metadata } from "next";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { AppBrand } from "@/components/brand";
import { PaymentActions } from "@/components/payment-actions";

import { assetsFor, BASE_CHAIN_ID } from "@/lib/assets/registry";
import type { BankRail } from "@/lib/format/bank";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { lookupPublicTag } from "@/lib/aura-tag-public";

type PaymentData = { tag: string; displayName: string; crypto: { network: string; address: string }; bank: { available: false } | { available: true; instructions: { bankName: string; bankAddress?: string; beneficiaryName: string; beneficiaryAddress?: string; accountNumber: string; routingNumber: string; rails: Array<"ach" | "wire" | "fednow"> } } };

export const metadata: Metadata = { title: { absolute: "Pay with Aura" }, description: "The ways to pay this Aura tag.", robots: { index: false } };

/** What a payer's own bank calls each way to send; the app's customer words are in lib/format/bank.ts. */
const payerRailNames: Record<BankRail, string> = { ach: "ACH", wire: "Wire", fednow: "FedNow" };

/** What shows in Aura when it arrives at the address: every asset held on Base, from the registry. */
const baseAssets = assetsFor("hold", BASE_CHAIN_ID);
const receivable = [...baseAssets.filter((asset) => asset.category !== "stock").map((asset) => asset.symbol),
  ...(baseAssets.some((asset) => asset.category === "stock") ? ["tokenized stocks"] : [])];
const receivableList = `${receivable.slice(0, -1).join(", ")}, or ${receivable.at(-1)}`;

/** The address in groups of four after 0x, which is easier to check against a wallet's screen. */
const grouped = (address: string) => [address.slice(0, 2), ...(address.slice(2).match(/.{1,4}/g) ?? [])];

/** An Aura tag's public payment page (journey J19): who you're paying, and the ways that are open. */
export default async function AuraTagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  // Limited per visitor, like the API: the address Cloudflare saw for this request.
  const result = await lookupPublicTag(env.PROJECTION_DB, tag, (await headers()).get("cf-connecting-ip"));
  const data = result.status === "available" ? result.payment as PaymentData : null;
  return <div className="pyPage">
    <header className="pyHeader"><AppBrand href="/" /></header>
    <main className="pyMain">{data ? <>
      {/* The tag leads: Aura checks it. The display name is whatever its owner typed, so it comes second and says so. */}
      <div className="pyWho"><span>Aura tag</span><h1>Pay @{data.tag}</h1><p>{data.displayName} <span>(the name they chose)</span></p></div>
      <section className="pyCard" aria-labelledby="pay-crypto">
        <div className="pyCardHead"><h2 id="pay-crypto">Crypto</h2></div>
        <p>Send {receivableList} on the {data.crypto.network} network. Other tokens, or any token on another network, won&apos;t show in their Aura account.</p>
        {/* EIP-681 with Base's chain ID, so a wallet that reads it sends on Base, not Ethereum. Always dark on light: wallets read that best. */}
        <div className="pyQr"><QRCodeSVG value={`ethereum:${data.crypto.address}@${BASE_CHAIN_ID}`} size={168} bgColor="transparent" fgColor="currentColor" role="img" aria-label={`QR code of @${data.tag}'s address on ${data.crypto.network}`} /></div>
        <code className="pyAddress">{grouped(data.crypto.address).map((part, index) => <span key={index}>{part}</span>)}</code>
        <PaymentActions address={data.crypto.address} />
      </section>
      {/* Change B5: someone with Aura pays in the app, with this tag filled in (signing in first if needed). */}
      <section className="pyCard pyWithAura" aria-labelledby="pay-with-aura">
        <div className="pyCardHead"><h2 id="pay-with-aura">Have Aura?</h2></div>
        <p>Send in the app with @{data.tag} filled in. Aura checks the tag&apos;s address again before you confirm.</p>
        {/* A visitor who isn't signed in gets Aura's sign-in straight away, then this payment. */}
        <Link className="appButton appButtonLarge" href={`/app/send?sendTo=${encodeURIComponent(data.crypto.address)}&tag=${encodeURIComponent(data.tag)}&sign-in`}>Send with Aura</Link>
      </section>
      {/* Change B6: only the ways that work. Bank details show when this person shared them; card payment isn't offered until it exists. */}
      {data.bank.available && <section className="pyCard" aria-labelledby="pay-bank">
        <div className="pyCardHead"><h2 id="pay-bank">Bank transfer</h2></div>
        <p>Send US dollars from your bank to these details. Check the beneficiary before you pay.</p>
        <dl className="pyDetails">
          <div><dt>Bank</dt><dd>{data.bank.instructions.bankName}</dd></div>
          {data.bank.instructions.bankAddress && <div><dt>Bank address</dt><dd>{data.bank.instructions.bankAddress}</dd></div>}
          <div><dt>Beneficiary</dt><dd>{data.bank.instructions.beneficiaryName}</dd></div>
          {data.bank.instructions.beneficiaryAddress && <div><dt>Beneficiary address</dt><dd>{data.bank.instructions.beneficiaryAddress}</dd></div>}
          <div><dt>Account number</dt><dd className="pyMono">{data.bank.instructions.accountNumber}</dd></div>
          <div><dt>Routing number</dt><dd className="pyMono">{data.bank.instructions.routingNumber}</dd></div>
          <div><dt>Accepts</dt><dd>{data.bank.instructions.rails.map((rail) => payerRailNames[rail]).join(", ")}</dd></div>
        </dl>
      </section>}
    </> : result.status === "rate_limited"
      // The limit is per visitor, whatever the tag, so saying so tells nothing about the tag.
      ? <section className="pyCard pyUnavailable"><h1>Too many requests</h1><p>You&apos;ve opened payment pages too often. Try again in a minute.</p>
        <a className="appButton appButtonLarge" href={`/pay/${encodeURIComponent(tag)}`}>Try again</a></section>
      : <section className="pyCard pyUnavailable"><h1>Payment page unavailable</h1><p>This Aura tag is not available for public payments.</p></section>}</main>
    <footer className="pyFooter">Aura is a wallet app. Crypto transfers may not be reversible, so check who you&apos;re paying before you send.</footer>
  </div>;
}
