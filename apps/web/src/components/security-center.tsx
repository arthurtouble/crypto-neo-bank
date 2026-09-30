"use client";

import { useExportWallet, useLinkAccount, useMfa, useMfaEnrollment, usePrivy, useWallets } from "@privy-io/react-auth";
import { useUpdateEmail } from "@privy-io/react-auth/ui";
import { LoaderCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { SettingRow } from "./setting-row";
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

  // The passkey leads (journey J15): every money action needs it.
  return <section className="mxCard stCard" aria-labelledby="sign-in-heading"><h2 id="sign-in-heading">Sign-in and security</h2>
    <SettingRow title="Passkey" detail={passkeyReady ? "Added. Needed to move money and to loosen your controls." : "Add one to move money."}>
      {passkeyReady ? <span className="stState">Added</span> : <button type="button" className="appButton appButtonPrimary" onClick={() => showMfaEnrollmentModal()}>Add passkey</button>}</SettingRow>
    <SettingRow id="email" title="Email" detail={email ? `${email}. Used to sign in and for email notices.` : "Add an email to get notices by email and to sign in without your wallet."}>
      <button type="button" className="appButton" onClick={() => email ? updateEmail() : linkEmail()}>{email ? "Change" : "Add email"}</button></SettingRow>
    <SettingRow title="Wallet key" detail="Export your account's key to use it in another wallet. Anyone with the key can move your money.">
      <button type="button" className="appButton" disabled={!wallet || exporting} onClick={() => void exportKey()}>{exporting ? <LoaderCircle className="spin" aria-hidden="true" /> : "Export"}</button></SettingRow>
  </section>;
}
