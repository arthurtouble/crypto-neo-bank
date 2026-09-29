"use client";

import { useSearchParams } from "next/navigation";
import { WalletWorkspace } from "./wallet-workspace";
import { AuraTagLookup } from "./aura-tag-lookup";
import { BankSendPanel } from "./bank-send-panel";

export function MoneyWorkspace({ mode }: { mode: "send" }) {
  const searchParams = useSearchParams();
  return <div className="moneySimple">
    {mode === "send" && <>
      <WalletWorkspace key={searchParams.toString()} />
      <section className="panel exampleCard"><span className="exampleLabel">People</span><h2>Aura tag and saved recipients</h2><p>Find a recipient by Aura tag. The address is checked again before you sign. Saved wallet addresses are in the crypto send review.</p><AuraTagLookup /></section>
      <BankSendPanel />
    </>}
  </div>;
}
