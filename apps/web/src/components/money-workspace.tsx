"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { MoneyAccount } from "@/lib/providers/service-catalog";
import { WalletWorkspace } from "./wallet-workspace";
import { AuraTagLookup } from "./aura-tag-lookup";

export function MoneyWorkspace({ mode }: { mode: "deposit" | "send" }) {
  const searchParams = useSearchParams();
  const { user, getAccessToken } = usePrivy();
  const account = useQuery<{ account: MoneyAccount }>({
    queryKey: ["money-account", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to see bank details.");
      const response = await fetch("/api/money/account", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Bank details are unavailable.");
      return response.json();
    },
    enabled: Boolean(user)
  });
  const active = account.data?.account.state === "active";
  return <div className="moneySimple">
    <WalletWorkspace key={`${mode}:${searchParams.toString()}`} mode={mode} />
    {mode === "deposit" ? <>
      <section className="panel exampleCard"><span className="exampleLabel">Bank transfer · Bridge</span><h2>Deposit from a bank</h2>
        {active ? <p>Bridge has connected an account, but complete transfer instructions are not available here yet. Do not send funds using the masked details below. Bank deposits are confirmed by Bridge.</p> : <p>Bank deposits become available after Bridge account setup and verification.</p>}
        {active && <div className="bankDetails"><span>Account name<strong>{account.data?.account.accountName}</strong></span><span>Account ending<strong>•••• {account.data?.account.accountNumberLastFour}</strong></span></div>}
        {account.isError && <p role="alert">{account.error.message}</p>}
      </section>
      <section className="panel exampleCard"><span className="exampleLabel">Aura tag</span><h2>Get paid with your tag</h2><p>Share a public payment page with crypto, bank, and card options. Each method shows its current availability.</p><Link className="button secondary" href="/app/settings#tag">Manage your tag</Link></section>
    </> : <>
      <section className="panel exampleCard"><span className="exampleLabel">People</span><h2>Aura tag and saved recipients</h2><p>Find a recipient by Aura tag. The address is checked again before you sign. Saved wallet addresses are in the crypto send review.</p><AuraTagLookup /></section>
      <section className="panel exampleCard"><span className="exampleLabel">Bank transfer · Bridge</span><h2>Send to a bank</h2><p>Bank transfers are unavailable until Bridge execution and beneficiary checks are connected. {active ? "A receiving account is connected, but outgoing transfers are not enabled." : "Set up a Bridge account when available."}</p></section>
    </>}
  </div>;
}
