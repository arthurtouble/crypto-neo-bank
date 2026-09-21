"use client";

import { Bell, BookOpen, Eye, EyeOff, Globe2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function SettingsWorkspace() {
  const [hidden, setHidden] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [securityNotices, setSecurityNotices] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHidden(localStorage.getItem("aurel-balance-privacy") === "hidden");
      setCurrency(localStorage.getItem("aurel-base-currency") ?? "USD");
      setSecurityNotices(localStorage.getItem("aurel-security-notices") !== "off");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  function privacy(value: boolean) { setHidden(value); localStorage.setItem("aurel-balance-privacy", value ? "hidden" : "visible"); document.documentElement.dataset.balancePrivacy = value ? "hidden" : "visible"; }
  function baseCurrency(value: string) { setCurrency(value); localStorage.setItem("aurel-base-currency", value); }
  function notices(value: boolean) { setSecurityNotices(value); localStorage.setItem("aurel-security-notices", value ? "on" : "off"); }
  return <div className="settingsGrid"><section className="panel settingsPanel">
    <div className="settingRow"><span className="settingIcon">{hidden ? <EyeOff size={17} /> : <Eye size={17} />}</span><div><strong>Balance privacy</strong><small>Blur sensitive amounts while using Aurel in shared spaces.</small></div><button className="settingsToggle" onClick={() => privacy(!hidden)}>{hidden ? "Hidden" : "Visible"}</button></div>
    <div className="settingRow"><span className="settingIcon"><Globe2 size={17} /></span><div><strong>Display currency</strong><small>Used for reporting and summaries. Assets remain denominated in their native units.</small></div><select value={currency} onChange={(event) => baseCurrency(event.target.value)}><option>USD</option><option>EUR</option><option>GBP</option></select></div>
    <div className="settingRow"><span className="settingIcon"><Bell size={17} /></span><div><strong>Security notices</strong><small>In-product warnings for policy, recovery, and high-risk activity.</small></div><button className="settingsToggle" onClick={() => notices(!securityNotices)}>{securityNotices ? "On" : "Off"}</button></div>
    <div className="settingRow"><span className="settingIcon"><BookOpen size={17} /></span><div><strong>Documents and disclosures</strong><small>Review custody, transaction, protocol, routing, data, and fee boundaries.</small></div><Link href="/docs">Open trust center</Link></div>
  </section><aside className="panel connectionPanel"><p className="eyebrow">ENVIRONMENT</p><h3>Production mainnet</h3><p>Aurel uses Base mainnet for its home account and only presents user-signed transactions. Development uses isolated local Cloudflare resources.</p><div className="securityPrinciple"><Globe2 size={17} /><span><strong>Base mainnet</strong><small>Chain ID 8453 · real assets and gas</small></span></div></aside></div>;
}
