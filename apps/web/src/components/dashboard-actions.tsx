"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Building2, Check, Copy, Plus, Send, Wallet, X } from "lucide-react";
import { useState } from "react";

function ModalFrame({ trigger, title, description, children }: { trigger: React.ReactNode; title: string; description: string; children: React.ReactNode }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialogOverlay" />
        <Dialog.Content className="dialogContent actionDialog">
          <div className="dialogHeader"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div><Dialog.Close className="dialogClose" aria-label="Close"><X size={18} /></Dialog.Close></div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DashboardActions() {
  const [fundingRail, setFundingRail] = useState<"bank" | "wallet">("bank");

  return (
    <div className="introActions">
      <ModalFrame trigger={<button className="button secondary"><Send size={15} /> Send</button>} title="Send funds" description="Review the destination and network before continuing.">
        <div className="dialogBody">
          <label className="fieldLabel">Recipient<input placeholder="Wallet address or saved recipient" /></label>
          <div className="amountField"><label>Amount<input inputMode="decimal" placeholder="0.00" /></label><button>USDC <span>⌄</span></button></div>
          <div className="transferMeta"><span>Network<strong>Base</strong></span><span>Available<strong>$28,450.18</strong></span><span>Estimated fee<strong>&lt; $0.01</strong></span></div>
          <div className="dialogNotice"><Check size={15} /><span>Withdrawal allowlist and risk checks run before signing.</span></div>
        </div>
        <div className="dialogActions"><Dialog.Close className="button secondary">Cancel</Dialog.Close><button className="button primary">Review transfer <ArrowRight size={15} /></button></div>
      </ModalFrame>

      <ModalFrame trigger={<button className="button primary"><Plus size={15} /> Add funds</button>} title="Add funds" description="Choose how you want to fund your Aurel wallet.">
        <div className="dialogBody">
          <div className="segmentedControl" aria-label="Funding method">
            <button className={fundingRail === "bank" ? "active" : ""} onClick={() => setFundingRail("bank")}><Building2 size={16} /> Bank transfer</button>
            <button className={fundingRail === "wallet" ? "active" : ""} onClick={() => setFundingRail("wallet")}><Wallet size={16} /> Crypto wallet</button>
          </div>
          {fundingRail === "bank" ? <div className="fundingDetails"><p className="eyebrow">USD VIRTUAL ACCOUNT · DEMO</p><dl><div><dt>Bank</dt><dd>Column N.A. · demonstration</dd></div><div><dt>Routing number</dt><dd>021000021 <button aria-label="Copy routing number"><Copy size={14} /></button></dd></div><div><dt>Account number</dt><dd>•••• 4881 <button aria-label="Copy account number"><Copy size={14} /></button></dd></div></dl><small>Use an account in your own name. Provider review may apply.</small></div> : <div className="fundingDetails"><p className="eyebrow">RECEIVE ON BASE</p><div className="walletAddress"><span>0x91e2…7a10</span><button><Copy size={14} /> Copy</button></div><small>Send only supported assets on Base. Other assets or networks may be unrecoverable.</small></div>}
        </div>
        <div className="dialogActions"><Dialog.Close className="button primary full">Done</Dialog.Close></div>
      </ModalFrame>
    </div>
  );
}

