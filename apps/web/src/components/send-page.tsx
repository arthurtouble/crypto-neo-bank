"use client";

import { useAuth } from "@/lib/client/auth";
import { Building2, ChevronRight, Wallet } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BankSendPanel } from "./bank-send-panel";
import { MoneyPage, SignedOutPanel } from "./money-page";
import { WalletWorkspace } from "./wallet-workspace";
import { LoadingState } from "./states";

const tabs = [
  { id: "crypto", label: "To a person or wallet", detail: "Crypto to an address or an Aura tag", icon: Wallet },
  { id: "bank", label: "To a bank account", detail: "Dollars to a US bank account", icon: Building2 }
] as const;
type Tab = (typeof tabs)[number]["id"];

/**
 * Send (journeys J5 and J6): crypto to a person or wallet, or dollars to a bank account, as tabs. Each ends on its
 * own review, then the passkey.
 */
export function SendPage() {
  const { authenticated, ready, login } = useAuth();
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

  return <MoneyPage title="Send" guest={isExample || loading} onSignIn={login} ready={ready}>
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
      {loading ? <LoadingState><strong>Setting up your account</strong></LoadingState>
        : tab === "crypto" ? (isExample ? <div className="mxSingle"><SignedOutPanel title="Send crypto" action="Sign in to send" onSignIn={login}>
            Send USDC, ETH, and other supported assets from your Aura account to an address or an Aura tag. You review every transfer before you confirm it with your passkey.</SignedOutPanel></div>
          // Remount on a new ?sendTo= link so the form starts from it.
          : <WalletWorkspace key={searchParams.toString()} />)
          : <div className="mxSingle">{isExample ? <SignedOutPanel title="Send to a bank" action="Sign in to send" onSignIn={login}>
            Send dollars from your Aura account to a US bank account, once Bridge has verified you.</SignedOutPanel> : <BankSendPanel />}</div>}
    </div>
  </MoneyPage>;
}
