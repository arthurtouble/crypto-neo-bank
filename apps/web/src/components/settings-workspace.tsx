"use client";

import { BookOpen, Eye, EyeOff, UserX } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FeedbackPanel } from "./feedback-panel";
import { NotificationPreferences } from "./notification-preferences";
import { DataRightsPanel } from "./data-rights-panel";
import { SecurityCenter } from "./security-center";
import { AuraTagControls } from "./aura-tag-controls";
import { ThemeToggle } from "./theme-toggle";

export function SettingsWorkspace() {
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
    <div className="settingRow"><span className="settingIcon">{hidden ? <EyeOff size={17} /> : <Eye size={17} />}</span><div><strong>Hide balances on this device</strong></div><button className="settingsToggle" onClick={() => privacy(!hidden)}>{hidden ? "Hidden" : "Visible"}</button></div>
    <NotificationPreferences />
    <div className="settingRow"><span className="settingIcon"><BookOpen size={17} /></span><div><strong>Documents and disclosures</strong></div><Link href="/docs">Open</Link></div>
    <div className="settingRow"><span className="settingIcon"><BookOpen size={17} /></span><div><strong>Statements</strong><small>Download a monthly statement from Transactions.</small></div><Link href="/app/transactions">Open</Link></div>
    <div className="settingRow"><span className="settingIcon"><Eye size={17} /></span><div><strong>Theme</strong></div><ThemeToggle /></div>
    <div className="settingRow"><span className="settingIcon"><UserX size={17} /></span><div><strong>Close your account</strong><small>Move your money out first, then contact support. We close accounts with no funds left.</small></div><Link href="/app/support?topic=close-account">Contact support</Link></div>
  </section><DataRightsPanel /><FeedbackPanel /></div>;
}
