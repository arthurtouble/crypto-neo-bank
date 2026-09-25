"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { WalletWorkspace } from "./wallet-workspace";
import { AuraTagLookup } from "./aura-tag-lookup";
import { BankDepositPanel } from "./bank-deposit-panel";
import { BankSendPanel } from "./bank-send-panel";

export function MoneyWorkspace({ mode }: { mode: "deposit" | "send" }) {
  const searchParams = useSearchParams();
  return <div className="moneySimple">
    <WalletWorkspace key={`${mode}:${searchParams.toString()}`} mode={mode} />
    {mode === "deposit" ? <>
      <BankDepositPanel />
      <section className="panel exampleCard"><span className="exampleLabel">Aura tag</span><h2>Get paid with your tag</h2><p>Share a public payment page with crypto, bank, and card options. Each method shows its current availability.</p><Link className="button secondary" href="/app/settings#tag">Manage your tag</Link></section>
    </> : <>
      <section className="panel exampleCard"><span className="exampleLabel">People</span><h2>Aura tag and saved recipients</h2><p>Find a recipient by Aura tag. The address is checked again before you sign. Saved wallet addresses are in the crypto send review.</p><AuraTagLookup /></section>
      <BankSendPanel />
    </>}
  </div>;
}
