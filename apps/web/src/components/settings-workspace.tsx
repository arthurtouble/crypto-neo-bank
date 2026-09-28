"use client";

import { Eye, EyeOff, SunMoon } from "lucide-react";
import { useEffect, useState } from "react";
import { NotificationPreferences } from "./notification-preferences";
import { DataRightsPanel } from "./data-rights-panel";
import { SecurityCenter } from "./security-center";
import { SecurityPolicyControls } from "./security-policy-controls";
import { AuraTagControls } from "./aura-tag-controls";
import { ThemeToggle } from "./theme-toggle";

/** Settings: sign-in and security, transaction controls, Aura tag, notifications, this device, and the customer's data. */
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
  return <div className="settingsGrid">
    <SecurityCenter />
    <SecurityPolicyControls />
    <AuraTagControls />
    <NotificationPreferences />
    <section className="panel settingsPanel" aria-labelledby="device-heading"><h2 id="device-heading">This device</h2>
      <div className="settingRow"><span className="settingIcon">{hidden ? <EyeOff size={17} /> : <Eye size={17} />}</span><div><strong>Hide balances</strong><small>Blur amounts on this device, for when others can see your screen.</small></div>
        <button className={`settingsToggle ${hidden ? "active" : ""}`} aria-pressed={hidden} aria-label="Hide balances" onClick={() => privacy(!hidden)}>{hidden ? "On" : "Off"}</button></div>
      <div className="settingRow"><span className="settingIcon"><SunMoon size={17} /></span><div><strong>Theme</strong></div><ThemeToggle /></div>
    </section>
    <DataRightsPanel />
  </div>;
}
