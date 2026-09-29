"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Building2, ChevronRight, LoaderCircle, Wallet } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuraTagLookup } from "./aura-tag-lookup";
import { BankSendPanel } from "./bank-send-panel";
import { GuestBanner } from "./guest-banner";
import { WalletWorkspace } from "./wallet-workspace";

const tabs = [
  { id: "crypto", label: "To a person or wallet", detail: "Crypto to an address or an Aura tag", icon: Wallet },
  { id: "bank", label: "To a bank account", detail: "Dollars to a US bank, through Bridge", icon: Building2 }
] as const;
type Tab = (typeof tabs)[number]["id"];

function TagCard({ isExample, onSignIn }: { isExample: boolean; onSignIn: () => void }) {
  return <section className="mxCard">
    <h2>Aura tag and saved recipients</h2>
    <p className="mxHint">Find a recipient by Aura tag. The address is checked again before you sign.</p>
    {isExample ? <button type="button" className="appButton" onClick={onSignIn}>Sign in to find a recipient</button> : <AuraTagLookup />}
  </section>;
}

/**
 * Send (journeys J5 and J6): crypto to a person or wallet, or dollars to a bank account. Tabs on desktop, rows on the
 * phone. Each ends on its own review, then the passkey.
 */
export function SendPage() {
  const { authenticated, ready, login } = usePrivy();
  const searchParams = useSearchParams();
  const isExample = ready && !authenticated;
  const loading = !ready;
  const [tab, setTab] = useState<Tab>("crypto");
  // /app/send#bank opens the bank tab; read after hydrating so the server render matches.
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (window.location.hash === "#bank") setTab("bank"); });
    return () => cancelAnimationFrame(frame);
  }, []);
  function choose(next: Tab) {
    setTab(next);
    window.history.replaceState(null, "", `${window.location.search}#${next}`);
  }

  return <div className="mxPage">
    {(isExample || loading) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="mxHead"><h1>Send</h1></header>
    <div className="mxTabs" role="tablist" aria-label="Where to send">
      {tabs.map(({ id, label, detail, icon: Icon }) => <button key={id} type="button" role="tab" id={`send-tab-${id}`} aria-controls={`send-panel-${id}`}
            aria-labelledby={`send-tab-${id}-label`} aria-describedby={`send-tab-${id}-detail`}
        aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => choose(id)}
        onKeyDown={(event) => {
          if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
          event.preventDefault();
          const next = tab === "crypto" ? "bank" : "crypto";
          choose(next);
          document.getElementById(`send-tab-${next}`)?.focus();
        }}>
        <span className="mxTabIcon"><Icon aria-hidden="true" /></span>
        <span className="mxTabText"><strong id={`send-tab-${id}-label`}>{label}</strong><small id={`send-tab-${id}-detail`}>{detail}</small></span>
        <ChevronRight className="mxTabChevron" aria-hidden="true" />
      </button>)}
    </div>
    <div role="tabpanel" id={`send-panel-${tab}`} aria-labelledby={`send-tab-${tab}-label`} className="mxTabPanel">
      {loading ? <div className="mxState" role="status"><LoaderCircle className="spin" aria-hidden="true" /><strong>Setting up your account</strong></div>
        : tab === "crypto" ? (isExample ? <div className="mxColumns">
          <div className="mxMain"><section className="mxPanel" aria-labelledby="send-crypto-title">
            <div className="mxPanelHead"><h2 id="send-crypto-title">Send crypto</h2>
              <p>Send USDC, ETH, and other supported assets from your Aura account to an address or an Aura tag. You review every transfer before you confirm it with your passkey.</p></div>
            <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={login}>Sign in to send</button>
          </section></div>
          <aside className="mxSide"><TagCard isExample onSignIn={login} /></aside>
        </div>
          // Remount on a new ?sendTo= link so the form starts from it.
          : <WalletWorkspace key={searchParams.toString()}><TagCard isExample={false} onSignIn={login} /></WalletWorkspace>)
          : isExample ? <section className="mxPanel" aria-labelledby="send-bank">
            <div className="mxPanelHead"><h2 id="send-bank">Send to a bank</h2>
              <p>Send dollars from your Aura account to a US bank account, once Bridge has verified you.</p></div>
            <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={login}>Sign in to send</button>
          </section> : <BankSendPanel />}
    </div>
  </div>;
}
