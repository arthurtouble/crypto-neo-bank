import { useMemo, type ReactNode } from "react";
import { useToast } from "./toast";

/**
 * One setting: a title and a short line on the left, its control on the right. As a label, the whole row names
 * its checkbox or field, so the control is reachable by the setting's title.
 */
export function SettingRow({ title, detail, children, id, label = false }: { title: ReactNode; detail?: ReactNode; children?: ReactNode; id?: string; label?: boolean }) {
  const body = <><span className="stRowText"><strong>{title}</strong>{detail && <small>{detail}</small>}</span>{children && <span className="stRowControl">{children}</span>}</>;
  return label ? <label className="stRow" id={id}>{body}</label> : <div className="stRow" id={id}>{body}</div>;
}

/** The one on/off control in Settings: a switch that saves as soon as it changes. */
export function Toggle({ label, on, busy, onChange }: { label: string; on: boolean; busy?: boolean; onChange: () => void }) {
  return <input type="checkbox" className="appSwitch" aria-label={label} checked={on} disabled={busy} onChange={onChange} />;
}

const settingsToast = "settings";

/** Toasts for Settings: they stack like any other, and close when the customer opens another area. */
export function useSettingsToast() {
  const toast = useToast();
  return useMemo(() => ({
    success: (title: string, detail?: string) => toast.show({ tone: "success", title, detail, key: settingsToast }),
    error: (title: string, detail?: string) => toast.show({ tone: "error", title, detail, key: settingsToast }),
    dismiss: () => toast.dismiss(settingsToast)
  }), [toast]);
}
