"use client";

import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { accountEmail } from "@/lib/client/account-email";
import { useAuth } from "@/lib/client/auth";
import { useWallet } from "@/lib/client/wallet-context";
import { SettingRow } from "./setting-row";
import { useToast } from "./toast";

/**
 * How the customer signs in and protects the account. Privy holds the sign-in
 * methods and the wallet key. Every account has an email before it gets this
 * far (components/terms-gate.tsx): one verified by Privy with a one-time code,
 * which can be changed here, or the Google sign-in's, which can be replaced by
 * adding one. Aura sends email notices there and doesn't keep a copy.
 */
export function SecurityCenter() {
  const { user } = useAuth();
  const { wallets, mfaMethods, showMfaEnrollmentModal, exportWallet, linkEmail: startLinkEmail, updateEmail } = useWallet();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const linkEmail = () => startLinkEmail({
    onSuccess: ({ linkMethod }) => { if (linkMethod === "email") toast.success("Email added"); },
    onError: (error) => { if (error !== "exited_link_flow") toast.error("Email not added", "Try again."); }
  });
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  // The server accepts a passkey or an authenticator app for money (`requireMoneyMfa`), so either counts here.
  const passkeyReady = mfaMethods.includes("passkey") || mfaMethods.includes("totp");
  const email = accountEmail(user);

  async function exportKey() {
    if (!wallet) return;
    setExporting(true);
    try { await exportWallet({ address: wallet.address }); }
    catch { toast.error("Key not exported", "Try again."); }
    finally { setExporting(false); }
  }

  // The passkey leads (journey J15): every money action needs it.
  return <section className="mxCard stCard" aria-labelledby="sign-in-heading"><h2 id="sign-in-heading">Sign-in and security</h2>
    <SettingRow title="Passkey" detail={passkeyReady ? "Added. Needed to move money and to loosen your controls." : "Add one to move money."}>
      {passkeyReady ? <span className="stState">Added</span> : <button type="button" className="appButton appButtonPrimary" onClick={() => showMfaEnrollmentModal()}>Add passkey</button>}</SettingRow>
    <SettingRow id="email" title="Email" detail={email?.source === "google" ? `${email.address}, from Google. Used for email notices.` : `${email?.address ?? "Your email"}. Used to sign in and for email notices.`}>
      <button type="button" className="appButton" onClick={() => email?.source === "google" ? linkEmail() : updateEmail()}>{email?.source === "google" ? "Use another email" : "Change"}</button></SettingRow>
    <SettingRow title="Wallet key" detail="Export your account's key to use it in another wallet. Anyone with the key can move your money.">
      <button type="button" className="appButton" disabled={!wallet || exporting} onClick={() => void exportKey()}>{exporting ? <LoaderCircle className="spin" aria-hidden="true" /> : "Export"}</button></SettingRow>
  </section>;
}
