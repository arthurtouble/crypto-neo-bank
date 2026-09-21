"use client";

import { useExportWallet, useMfa, useMfaEnrollment, usePrivy, useSetWalletRecovery, useWallets } from "@privy-io/react-auth";
import { Check, Download, Fingerprint, KeyRound, LoaderCircle, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

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
    { icon: Fingerprint, title: "Passkey protection", note: passkeyReady ? "Enabled for sensitive wallet actions" : "Required before material-value actions", state: passkeyReady ? "Enabled" : "Set up", action: () => showMfaEnrollmentModal() },
    { icon: KeyRound, title: "User-controlled recovery", note: "Configure a recovery method independent of Aurel", state: "Review", action: () => run("Recovery setup", () => setWalletRecovery()) },
    { icon: Download, title: "Wallet export", note: "Privy displays the secret in an isolated interface Aurel cannot read", state: "Available", action: () => wallet ? run("Wallet export", () => exportWallet({ address: wallet.address })) : undefined },
    { icon: MonitorSmartphone, title: "Current session", note: `${user?.email?.address ?? user?.id ?? "Authenticated user"} · this browser`, state: "Active", action: undefined }
  ];

  return <div className="contentGrid"><section className="panel widePanel"><div className="panelHeading"><div><p className="eyebrow">PRIVY SECURITY</p><h2>Account protection</h2></div><span className={`statusBadge ${passkeyReady ? "good" : "neutral"}`}><i /> {passkeyReady ? "Strong" : "Action required"}</span></div>
    <div className="securityChecklist">{controls.map(({ icon: Icon, title, note, state, action }) => <div key={title}><span className={state === "Enabled" || state === "Active" ? "good" : "warn"}><Icon size={19} /></span><div><strong>{title}</strong><small>{note}</small></div>{action ? <button disabled={Boolean(working)} onClick={action}>{working && title.startsWith(working.split(" ")[0]) ? <LoaderCircle className="spin" size={14} /> : state}</button> : <b className="securityState"><Check size={14} /> {state}</b>}</div>)}</div>
    {message && <div className="securityMessage" role="status">{message}</div>}
  </section><aside className="panel connectionPanel"><p className="eyebrow">CONTROL MODEL</p><h3>You remain the final signer</h3><p>Aurel can prepare and explain transactions, but the default wallet requires your explicit confirmation. Aurel does not receive the recovery secret displayed by Privy.</p><div className="securityPrinciple"><ShieldCheck size={17} /><span><strong>No delegated signer</strong><small>Automated asset movement is disabled.</small></span></div><div className="securityPrinciple"><KeyRound size={17} /><span><strong>Export path</strong><small>Your wallet is not locked to Aurel.</small></span></div></aside></div>;
}

