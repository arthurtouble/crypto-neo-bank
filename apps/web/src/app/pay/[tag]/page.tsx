import type { Metadata } from "next";
import { QRCodeSVG } from "qrcode.react";
import { Brand } from "@/components/brand";
import { PaymentActions } from "@/components/payment-actions";
import { GET as getPublicTag } from "@/app/api/aura-tags/[tag]/route";

type PaymentData = { tag: string; displayName: string; crypto: { network: string; address: string }; bank: { available: false } | { available: true; instructions: { bankName: string; bankAddress?: string; beneficiaryName: string; beneficiaryAddress?: string; accountNumber: string; routingNumber: string; rails: Array<"ach" | "wire" | "fednow"> } } };

export const metadata: Metadata = { title: "Pay with Aura", description: "View available payment methods for an Aura tag." };

export default async function AuraTagPage({ params }: { params: Promise<{ tag: string }> }) {
  const { tag } = await params;
  const response = await getPublicTag(new Request(`https://aura.local/pay/${encodeURIComponent(tag)}`), { params: Promise.resolve({ tag }) });
  const data = response.ok ? await response.json() as PaymentData : null;
  return <div className="payPage">
    <header className="payHeader"><Brand /></header>
    <main className="payMain">{data ? <>
      <p className="eyebrow">Aura tag</p><h1>Pay {data.displayName}</h1><p className="payTag">@{data.tag}</p>
      <div className="payMethods">
        <section className="panel payMethod"><div><h2>Crypto</h2><span className="statusBadge good">Available</span></div><p>Send supported assets on {data.crypto.network}. Check the network and address in your wallet before sending.</p><div className="receiveQr"><QRCodeSVG value={data.crypto.address} size={160} bgColor="transparent" fgColor="currentColor" /></div><code className="addressBlock">{data.crypto.address}</code><PaymentActions address={data.crypto.address} /></section>
        <section className="panel payMethod"><div><h2>Bank transfer</h2><span className={`statusBadge ${data.bank.available ? "good" : "neutral"}`}>{data.bank.available ? "Available" : "Unavailable"}</span></div>{data.bank.available ? <><p>Send USD using the Bridge instructions below. Confirm the beneficiary before paying.</p><div className="bankDetails"><span>Bank<strong>{data.bank.instructions.bankName}</strong></span>{data.bank.instructions.bankAddress && <span>Bank address<strong>{data.bank.instructions.bankAddress}</strong></span>}<span>Beneficiary<strong>{data.bank.instructions.beneficiaryName}</strong></span>{data.bank.instructions.beneficiaryAddress && <span>Beneficiary address<strong>{data.bank.instructions.beneficiaryAddress}</strong></span>}<span>Account number<strong>{data.bank.instructions.accountNumber}</strong></span><span>Routing number<strong>{data.bank.instructions.routingNumber}</strong></span><span>Accepted rails<strong>{data.bank.instructions.rails.map((rail) => rail === "ach" ? "ACH push" : rail === "wire" ? "Wire" : "FedNow").join(", ")}</strong></span></div></> : <p>Bank details appear only when this recipient has an active Bridge account and has chosen to share them.</p>}</section>
        <section className="panel payMethod"><div><h2>Card payment</h2><span className="statusBadge neutral">Unavailable</span></div><p>Card payments require a connected acquiring and payment-link provider. No card checkout is active.</p></section>
      </div>
    </> : <section className="panel payUnavailable"><h1>Payment page unavailable</h1><p>This Aura tag is not available for public payments.</p></section>}</main>
    <footer className="payFooter">Aura is a wallet interface. Crypto transfers may be irreversible. Confirm the recipient before sending.</footer>
  </div>;
}
