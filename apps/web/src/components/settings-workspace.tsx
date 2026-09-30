"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, AtSign, Bell, ChevronRight, FileText, LoaderCircle, ShieldCheck, Smartphone, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { exampleRecipients } from "@/lib/example/data";
import { AuraTagControls } from "./aura-tag-controls";
import { DataRightsPanel } from "./data-rights-panel";
import { GuestBanner } from "./guest-banner";
import { NotificationPreferences } from "./notification-preferences";
import { SecurityCenter } from "./security-center";
import { SavedRecipients, TransactionControls } from "./security-policy-controls";
import { SettingRow, Toggle } from "./setting-row";
import { ThemeChoice } from "./theme-choice";

const areas = [
  { id: "security", label: "Security", detail: "Passkey, email, lock, and limits", icon: ShieldCheck },
  { id: "recipients", label: "Saved recipients", detail: "Who you can send to by name", icon: Users },
  { id: "tag", label: "Aura tag", detail: "Your public name and payment page", icon: AtSign },
  { id: "notifications", label: "Notifications", detail: "Email and this browser", icon: Bell },
  { id: "device", label: "This device", detail: "Hide balances and theme", icon: Smartphone },
  { id: "data", label: "Your data", detail: "Download, terms, and closing the account", icon: FileText }
] as const;
type Area = (typeof areas)[number]["id"];
/** Older links point at a setting inside an area. */
const inside: Record<string, Area> = { "emergency-lock": "security", email: "security" };

function areaFromHash(): Area | null {
  const hash = window.location.hash.slice(1);
  return areas.some((area) => area.id === hash) ? hash as Area : inside[hash] ?? null;
}

function DeviceArea() {
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
  return <section className="mxCard stCard" aria-labelledby="device-heading"><h2 id="device-heading">This device</h2>
    <SettingRow title="Hide balances" detail="Blur amounts on this device, for when others can see your screen."><Toggle label="Hide balances" on={hidden} onChange={() => privacy(!hidden)} /></SettingRow>
    <SettingRow title="Theme" detail="Follow this device, or always use light or dark."><ThemeChoice /></SettingRow>
  </section>;
}

/** What each area holds, for guests: the same rows, described, with one way to sign in. */
const guestRows: Record<Exclude<Area, "device">, Array<[string, string]>> = {
  security: [["Passkey", "Needed to move money and to loosen your controls."], ["Email", "Used to sign in and for email notices."],
    ["Emergency lock", "Stop all sends, swaps, and Earn moves. Unlocking needs your passkey."], ["Daily transfer limit", "The most you can send in a day."],
    ["Saved recipients only", "Only send to saved recipients, after their wait."], ["Wallet key", "Export your account's key to use it in another wallet."]],
  recipients: exampleRecipients.map((item) => [item.name, `${item.detail} · Ready`]),
  tag: [["Aura tag", "A public name for receiving crypto, with a payment page you can show or hide."]],
  notifications: [["Transaction emails", "Money you receive, and when a send, swap, or Earn move completes or fails."], ["Browser notifications", "On in the browsers where you turn them on."],
    ["Product news", "Occasional emails about what's new in Aura. Off unless you turn it on."]],
  data: [["Download my data", "A copy of everything Aura holds about you, as a file."], ["Terms and privacy", "The documents you accept, and how Aura uses your data."],
    ["Close your account", "Move your money out first, then contact support."]]
};

function GuestArea({ area, onSignIn }: { area: Exclude<Area, "device">; onSignIn: () => void }) {
  const title = areas.find((item) => item.id === area)!.label;
  return <section className="mxCard stCard" aria-labelledby={`guest-${area}`}><h2 id={`guest-${area}`}>{title}</h2>
    {guestRows[area].map(([name, detail]) => <SettingRow key={name} title={name} detail={detail} />)}
    <button type="button" className="appButton appButtonPrimary mxStart" onClick={onSignIn}>Sign in to change these</button>
  </section>;
}

function AreaContent({ area, isExample, onSignIn }: { area: Area; isExample: boolean; onSignIn: () => void }) {
  if (area === "device") return <DeviceArea />;
  if (isExample) return <GuestArea area={area} onSignIn={onSignIn} />;
  if (area === "security") return <><SecurityCenter /><TransactionControls /></>;
  if (area === "recipients") return <SavedRecipients />;
  if (area === "tag") return <AuraTagControls />;
  if (area === "notifications") return <NotificationPreferences />;
  return <DataRightsPanel />;
}

/**
 * Settings (journeys J15 and J16), one area at a time: a side list on desktop; on the phone, a row per area that opens
 * its own screen. The URL's hash names the area, so links and the back button work.
 */
export function SettingsWorkspace() {
  const { user, ready, authenticated, login } = usePrivy();
  const isExample = ready && !authenticated;
  const [selected, setSelected] = useState<Area | null>(null);
  useEffect(() => {
    const sync = () => {
      const next = areaFromHash();
      setSelected(next);
      // A link to one setting (#emergency-lock) lands on it once its area shows.
      const target = window.location.hash.slice(1);
      if (next && target !== next) window.setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: "center" }), 300);
    };
    const frame = requestAnimationFrame(sync);
    window.addEventListener("hashchange", sync);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", sync); };
  }, []);
  // Desktop always shows an area; the phone shows the list until one is chosen.
  const area = selected ?? "security";
  const who = isExample ? "Example account" : user?.email?.address ?? (user?.wallet?.address ? `${user.wallet.address.slice(0, 6)}…${user.wallet.address.slice(-4)}` : null);

  return <div className="mxPage stPage" data-view={selected ? "area" : "index"}>
    {(isExample || !ready) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="stHead"><h1>Settings</h1>{who && <p className="mxHint">Signed in as {who}</p>}</header>
    {!ready ? <div className="mxState" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Loading your settings</div>
      : <div className="stLayout">
        <nav className="stNav" aria-label="Settings sections">
          {areas.map(({ id, label, detail, icon: Icon }) => <a key={id} href={`#${id}`} aria-current={area === id ? "page" : undefined} onClick={() => setSelected(id)}>
            <span className="stNavIcon" aria-hidden="true"><Icon /></span>
            <span className="stNavText"><strong>{label}</strong><small>{detail}</small></span>
            <ChevronRight className="stNavChevron" aria-hidden="true" />
          </a>)}
        </nav>
        <div className="stArea">
          <button type="button" className="appTextButton stBack" onClick={() => { window.history.pushState(null, "", window.location.pathname); setSelected(null); }}>
            <ArrowLeft aria-hidden="true" /> All settings</button>
          <AreaContent area={area} isExample={isExample} onSignIn={login} />
        </div>
      </div>}
  </div>;
}
