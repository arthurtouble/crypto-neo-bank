"use client";

import { useExportWallet, useLinkAccount, useMfa, useMfaEnrollment, usePrivy, useWallets } from "@privy-io/react-auth";
import { useUpdateEmail } from "@privy-io/react-auth/ui";
import { Download, Fingerprint, LoaderCircle, Mail } from "lucide-react";
import { useMemo, useState } from "react";
import { useToast } from "./toast";

/**
 * How the customer signs in and protects the account. Privy holds the sign-in
 * methods and the wallet key: an email added here is verified by Privy with a
 * one-time code, becomes a way to sign in (so the account isn't tied to one
 * wallet), and is where Aura sends email notices. Aura doesn't keep a copy.
 */
export function SecurityCenter() {
  const { user } = usePrivy();
  const { wallets } = useWallets();
  const { mfaMethods } = useMfa();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const { exportWallet } = useExportWallet();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const { linkEmail } = useLinkAccount({
    onSuccess: ({ linkMethod }) => { if (linkMethod === "email") toast.success("Email added"); },
    onError: (error) => { if (error !== "exited_link_flow") toast.error("Email not added", "Try again."); }
  });
  const { update: updateEmail } = useUpdateEmail();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  // The server accepts a passkey or an authenticator app for money (`requireMoneyMfa`), so either counts here.
  const passkeyReady = mfaMethods.includes("passkey") || mfaMethods.includes("totp");
  const email = user?.email?.address;

  async function exportKey() {
    if (!wallet) return;
    setExporting(true);
    try { await exportWallet({ address: wallet.address }); }
    catch { toast.error("Key not exported", "Try again."); }
    finally { setExporting(false); }
  }

  return <section className="panel settingsPanel" aria-labelledby="sign-in-heading"><h2 id="sign-in-heading">Sign-in and security</h2>
    <div className="settingRow" id="email"><span className="settingIcon"><Mail size={17} /></span>
      <div><strong>Email</strong><small>{email ? `${email}. Used to sign in and for email notices.` : "Add an email to get notices by email and to sign in without your wallet."}</small></div>
      <button onClick={() => email ? updateEmail() : linkEmail()}>{email ? "Change" : "Add email"}</button></div>
    <div className="settingRow"><span className="settingIcon"><Fingerprint size={17} /></span>
      <div><strong>Passkey</strong><small>{passkeyReady ? "Added. Needed to move money and to loosen your controls." : "Add one to move money."}</small></div>
      {passkeyReady ? <span className="settingState">Added</span> : <button onClick={() => showMfaEnrollmentModal()}>Add passkey</button>}</div>
    <div className="settingRow"><span className="settingIcon"><Download size={17} /></span>
      <div><strong>Wallet key</strong><small>Export your account&apos;s key to use it in another wallet. Anyone with the key can move your money.</small></div>
      <button disabled={!wallet || exporting} onClick={() => void exportKey()}>{exporting ? <LoaderCircle className="spin" size={14} /> : "Export"}</button></div>
  </section>;
}
