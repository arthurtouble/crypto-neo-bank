"use client";

import { useExportWallet, useMfa, useMfaEnrollment, usePrivy, useSetWalletRecovery, useWallets } from "@privy-io/react-auth";
import { Check, Download, Fingerprint, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { SecurityPolicyControls } from "./security-policy-controls";
import { useToast } from "./toast";

export function SecurityCenter() {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { mfaMethods } = useMfa();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const { setWalletRecovery } = useSetWalletRecovery();
  const { exportWallet } = useExportWallet();
  const [working, setWorking] = useState<string | null>(null);
  const toast = useToast();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  // The server accepts a passkey or an authenticator app for money (`requireMoneyMfa`), so either counts here.
  const passkeyReady = mfaMethods.includes("passkey") || mfaMethods.includes("totp");

  async function run(label: string, action: () => Promise<unknown>) {
    setWorking(label);
    try { await action(); toast.success(`${label} completed`); }
    catch (error) { toast.error(`${label} not completed`, error instanceof Error ? error.message : undefined); }
    finally { setWorking(null); }
  }

  const controls = [
    { icon: Fingerprint, title: "Passkey", note: passkeyReady ? "Needed to move money and to loosen your controls" : "Add one to move money", state: passkeyReady ? "Added" : "Add", action: () => showMfaEnrollmentModal() },
    { icon: KeyRound, title: "Recovery", note: "Review how you'd get back into your wallet", state: "Review", action: () => run("Recovery setup", () => setWalletRecovery()) },
    { icon: Download, title: "Wallet export", note: "Export your wallet's key", state: "Export", action: () => wallet ? run("Wallet export", () => exportWallet({ address: wallet.address })) : undefined }
  ];

  return <><div className="contentGrid"><section className="panel widePanel"><div className="panelHeading"><div><h2>Account protection</h2><p className="sourceCaption">{user?.email?.address ? `Signed in as ${user.email.address}` : "Signed in"}</p></div><span className={`statusBadge ${passkeyReady ? "good" : "neutral"}`}><i /> {passkeyReady ? "Passkey added" : "No passkey yet"}</span></div>
    <div className="securityChecklist">{controls.map(({ icon: Icon, title, note, state, action }) => <div key={title}><span className={state === "Added" ? "good" : "warn"}><Icon size={19} /></span><div><strong>{title}</strong><small>{note}</small></div>{action ? <button disabled={Boolean(working)} onClick={action}>{working && title.startsWith(working.split(" ")[0]) ? <LoaderCircle className="spin" size={14} /> : state}</button> : <b className="securityState"><Check size={14} /> {state}</b>}</div>)}</div>
  </section><aside className="panel connectionPanel"><h3>You stay in control</h3><div className="securityPrinciple"><ShieldCheck size={17} /><span><strong>You approve every transfer</strong></span></div><div className="securityPrinciple"><KeyRound size={17} /><span><strong>You can export your wallet</strong></span></div></aside></div><SecurityPolicyControls /></>;
}
