"use client";

import { useExportWallet, useMfa, useMfaEnrollment, usePrivy, useSetWalletRecovery, useWallets } from "@privy-io/react-auth";
import { Check, Download, Fingerprint, KeyRound, LoaderCircle, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { SecurityPolicyControls } from "./security-policy-controls";

export function SecurityCenter() {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { mfaMethods } = useMfa();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const { setWalletRecovery } = useSetWalletRecovery();
  const { exportWallet } = useExportWallet();
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const passkeyReady = mfaMethods.includes("passkey");

  async function run(label: string, action: () => Promise<unknown>) {
    setWorking(label); setMessage(null);
    try { await action(); setMessage(`${label} completed.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : `${label} could not be completed.`); }
    finally { setWorking(null); }
  }

  const controls = [
    { icon: Fingerprint, title: "Account Passkey", note: passkeyReady ? "Added to your account" : "Add a passkey to your account", state: passkeyReady ? "Enabled" : "Set Up", action: () => showMfaEnrollmentModal() },
    { icon: KeyRound, title: "Account Recovery", note: "Review your recovery method", state: "Review", action: () => run("Recovery setup", () => setWalletRecovery()) },
    { icon: Download, title: "Wallet Export", note: "Export your wallet securely", state: "Available", action: () => wallet ? run("Wallet export", () => exportWallet({ address: wallet.address })) : undefined },
    { icon: MonitorSmartphone, title: "Current Session", note: `${user?.email?.address ?? user?.id ?? "Signed in"} · this browser`, state: "Active", action: undefined }
  ];

  return <><div className="contentGrid"><section className="panel widePanel"><div className="panelHeading"><div><h2>Account Protection</h2></div><span className={`statusBadge ${passkeyReady ? "good" : "neutral"}`}><i /> {passkeyReady ? "Passkey Added" : "Passkey Available"}</span></div>
    <div className="securityChecklist">{controls.map(({ icon: Icon, title, note, state, action }) => <div key={title}><span className={state === "Enabled" || state === "Active" ? "good" : "warn"}><Icon size={19} /></span><div><strong>{title}</strong><small>{note}</small></div>{action ? <button disabled={Boolean(working)} onClick={action}>{working && title.startsWith(working.split(" ")[0]) ? <LoaderCircle className="spin" size={14} /> : state}</button> : <b className="securityState"><Check size={14} /> {state}</b>}</div>)}</div>
    {message && <div className="securityMessage" role="status">{message}</div>}
  </section><aside className="panel connectionPanel"><h3>You Stay in Control</h3><div className="securityPrinciple"><ShieldCheck size={17} /><span><strong>You Approve Transfers</strong></span></div><div className="securityPrinciple"><KeyRound size={17} /><span><strong>Wallet Export Available</strong></span></div></aside></div><SecurityPolicyControls /></>;
}
