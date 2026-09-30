import type { ReactNode } from "react";

/**
 * One setting: a title and a short line on the left, its control on the right. As a label, the whole row names
 * its checkbox or field, so the control is reachable by the setting's title.
 */
export function SettingRow({ title, detail, children, id, label = false }: { title: ReactNode; detail?: ReactNode; children?: ReactNode; id?: string; label?: boolean }) {
  const body = <><span className="stRowText"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>{children && <span className="stRowControl">{children}</span>}</>;
  return label ? <label className="stRow" id={id}>{body}</label> : <div className="stRow" id={id}>{body}</div>;
}

/** An On/Off button for a setting that saves as soon as it changes. */
export function Toggle({ label, on, busy, onChange }: { label: string; on: boolean; busy?: boolean; onChange: () => void }) {
  return <button type="button" className="appToggle" aria-pressed={on} aria-label={label} disabled={busy} onClick={onChange}>{on ? "On" : "Off"}</button>;
}
