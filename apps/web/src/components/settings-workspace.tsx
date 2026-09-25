"use client";

import { usePrivy } from "@privy-io/react-auth";
import { BookOpen, Eye, EyeOff, Fingerprint, KeyRound, MonitorSmartphone, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FeedbackPanel } from "./feedback-panel";
import { NotificationPreferences } from "./notification-preferences";
import { DataRightsPanel } from "./data-rights-panel";
import { SecurityCenter } from "./security-center";
import { AuraTagControls } from "./aura-tag-controls";
import { ThemeToggle } from "./theme-toggle";

export function SettingsWorkspace() {
  const { user } = usePrivy();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setHidden(localStorage.getItem("aurel-balance-privacy") === "hidden"), 0);
    return () => window.clearTimeout(timer);
  }, []);
  function privacy(value: boolean) {
    setHidden(value);
    localStorage.setItem("aurel-balance-privacy", value ? "hidden" : "visible");
    document.documentElement.dataset.balancePrivacy = value ? "hidden" : "visible";
  }
  return <div className="settingsGrid"><SecurityCenter /><AuraTagControls /><section className="panel settingsPanel">
    <h2>Account and preferences</h2>
    <div className="settingRow"><span className="settingIcon"><Fingerprint size={17} /></span><div><strong>Account details and sign-in</strong><small>{user?.email?.address ?? "Managed by Privy"}</small></div><span>Privy</span></div>
    <div className="settingRow"><span className="settingIcon"><MonitorSmartphone size={17} /></span><div><strong>Sessions</strong><small>Current browser shown above; remote session management requires identity-provider support.</small></div><span>Current only</span></div>
    <div className="settingRow"><span className="settingIcon"><KeyRound size={17} /></span><div><strong>Passcode</strong><small>Passkey and wallet recovery controls are shown above. A separate app passcode is not connected.</small></div><span>Unavailable</span></div>
    <div className="settingRow"><span className="settingIcon"><ShieldCheck size={17} /></span><div><strong>Transfer limits and wealth protection</strong><small>Account lock, saved destinations, and limits are shown above.</small></div><span>Active controls</span></div>
    <div className="settingRow"><span className="settingIcon">{hidden ? <EyeOff size={17} /> : <Eye size={17} />}</span><div><strong>Hide balances on this device</strong></div><button className="settingsToggle" onClick={() => privacy(!hidden)}>{hidden ? "Hidden" : "Visible"}</button></div>
    <NotificationPreferences />
    <div className="settingRow"><span className="settingIcon"><BookOpen size={17} /></span><div><strong>Documents and disclosures</strong></div><Link href="/docs">Open</Link></div>
    <div className="settingRow"><span className="settingIcon"><BookOpen size={17} /></span><div><strong>Statements</strong><small>Issuer statements appear when a provider is connected.</small></div><span>Unavailable</span></div>
    <div className="settingRow"><span className="settingIcon"><Eye size={17} /></span><div><strong>Theme</strong></div><ThemeToggle /></div>
  </section><DataRightsPanel /><FeedbackPanel /></div>;
}
