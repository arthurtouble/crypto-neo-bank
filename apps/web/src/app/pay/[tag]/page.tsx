import type { Metadata } from "next";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { AppBrand } from "@/components/brand";
import { PaymentActions } from "@/components/payment-actions";
import { GET as getPublicTag } from "@/app/api/aura-tags/[tag]/route";

type PaymentData = { tag: string; displayName: string; crypto: { network: string; address: string }; bank: { available: false } | { available: true; instructions: { bankName: string; bankAddress?: string; beneficiaryName: string; beneficiaryAddress?: string; accountNumber: string; routingNumber: string; rails: Array<"ach" | "wire" | "fednow"> } } };

export const metadata: Metadata = { title: "Pay with Aura", description: "View available payment methods for an Aura tag." };

const Status = ({ available }: { available: boolean }) => <span className={`pyStatus${available ? " pyStatusOn" : ""}`}>{available ? "Available" : "Unavailable"}</span>;

/** An Aura tag's public payment page (journey J19): who you're paying, and the ways that are open. */
export default async function AuraTagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const response = await getPublicTag(new Request(`https://aura.local/pay/${encodeURIComponent(tag)}`), { params: Promise.resolve({ tag }) });
  const data = response.ok ? await response.json() as PaymentData : null;
  return <div className="pyPage">
    <header className="pyHeader"><AppBrand href="/" /></header>
    <main className="pyMain">{data ? <>
      <div className="pyWho"><span>Aura tag</span><h1>Pay {data.displayName}</h1><p>@{data.tag}</p></div>
      <section className="pyCard" aria-labelledby="pay-crypto">
        <div className="pyCardHead"><h2 id="pay-crypto">Crypto</h2><Status available /></div>
        <p>Send supported assets on {data.crypto.network}. Check the network and address in your wallet before sending.</p>
        <div className="pyQr"><QRCodeSVG value={data.crypto.address} size={168} bgColor="transparent" fgColor="currentColor" role="img" aria-label={`QR code of ${data.displayName}'s address`} /></div>
        <code className="pyAddress">{data.crypto.address}</code>
        <PaymentActions address={data.crypto.address} />
      </section>
      {/* Change B5: someone with Aura pays in the app, with this tag filled in (signing in first if needed). */}
      <section className="pyCard pyWithAura" aria-labelledby="pay-with-aura">
        <div className="pyCardHead"><h2 id="pay-with-aura">Have Aura?</h2></div>
        <p>Send in the app with @{data.tag} filled in. Aura checks the tag&apos;s address again before you confirm.</p>
        <Link className="appButton appButtonLarge" href={`/app/send?sendTo=${encodeURIComponent(data.crypto.address)}&tag=${encodeURIComponent(data.tag)}`}>Send with Aura</Link>
      </section>
      {/* Change B6: only the ways that work. Bank details show when this person shared them; card payment isn't offered until it exists. */}
      {data.bank.available && <section className="pyCard" aria-labelledby="pay-bank">
        <div className="pyCardHead"><h2 id="pay-bank">Bank transfer</h2><Status available /></div>
        <p>Send USD using the Bridge instructions below. Confirm the beneficiary before paying.</p>
        <dl className="pyDetails">
          <div><dt>Bank</dt><dd>{data.bank.instructions.bankName}</dd></div>
          {data.bank.instructions.bankAddress && <div><dt>Bank address</dt><dd>{data.bank.instructions.bankAddress}</dd></div>}
          <div><dt>Beneficiary</dt><dd>{data.bank.instructions.beneficiaryName}</dd></div>
          {data.bank.instructions.beneficiaryAddress && <div><dt>Beneficiary address</dt><dd>{data.bank.instructions.beneficiaryAddress}</dd></div>}
          <div><dt>Account number</dt><dd className="pyMono">{data.bank.instructions.accountNumber}</dd></div>
          <div><dt>Routing number</dt><dd className="pyMono">{data.bank.instructions.routingNumber}</dd></div>
          <div><dt>Accepts</dt><dd>{data.bank.instructions.rails.map((rail) => rail === "ach" ? "ACH push" : rail === "wire" ? "Wire" : "FedNow").join(", ")}</dd></div>
        </dl>
      </section>}
    </> : <section className="pyCard pyUnavailable"><h1>Payment page unavailable</h1><p>This Aura tag is not available for public payments.</p></section>}</main>
    <footer className="pyFooter">Aura is a wallet app. Crypto transfers may not be reversible, so check who you're paying before you send.</footer>
  </div>;
}
