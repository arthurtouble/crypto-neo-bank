"use client";

import { Check, CircleAlert, Info, X } from "lucide-react";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastTone = "success" | "error" | "info";
export type ToastInput = {
  tone: ToastTone;
  title: string;
  detail?: string;
  /** A link the customer can follow, such as "Open Transactions". */
  link?: { label: string; href: string };
  /** Names a group of toasts the screen can close together, such as Settings' when the customer leaves it. */
  key?: string;
  /** Keep it on screen until the customer closes it. Use for outcomes they must act on. */
  sticky?: boolean;
};
export type Toast = ToastInput & { id: number };

type ToastApi = {
  show: (toast: ToastInput) => void;
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  dismiss: (key: string) => void;
};

const DURATION_MS: Record<ToastTone, number> = { success: 5_000, info: 5_000, error: 8_000 };
const noop = () => undefined;
const ToastContext = createContext<ToastApi>({ show: noop, success: noop, error: noop, dismiss: noop });

/** Show outcomes of what the customer just did. Field hints and load failures stay next to the content they describe. */
export function useToast() {
  return useContext(ToastContext);
}

/**
 * Add a toast under the ones still showing, so a second notice arriving at the same moment never hides the first.
 * Only a repeat of the same message (same title) takes the earlier one's place, with its newer detail, so it never shows twice.
 */
export function addToast(current: Toast[], toast: Toast): Toast[] {
  return [...current.filter((item) => item.title !== toast.title), toast];
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const close = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = ++nextId.current;
    setToasts((current) => addToast(current, { ...toast, id }));
  }, []);
  const api = useMemo<ToastApi>(() => ({
    show,
    success: (title, detail) => show({ tone: "success", title, detail }),
    error: (title, detail) => show({ tone: "error", title, detail }),
    dismiss: (key) => setToasts((current) => current.filter((toast) => toast.key !== key))
  }), [show]);

  return <ToastContext.Provider value={api}>
    {children}
    <section className="toastRegion" aria-label="Notifications">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onClose={close} />)}
    </section>
  </ToastContext.Provider>;
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (toast.sticky || paused) return;
    const timer = setTimeout(() => onClose(toast.id), DURATION_MS[toast.tone]);
    return () => clearTimeout(timer);
  }, [toast.id, toast.sticky, toast.tone, paused, onClose]);

  const Icon = toast.tone === "success" ? Check : toast.tone === "error" ? CircleAlert : Info;
  return <div className={`toast ${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    <span className="toastIcon"><Icon size={16} /></span>
    <div className="toastText">
      <strong>{toast.title}</strong>
      {toast.detail && <small>{toast.detail}</small>}
      {toast.link && <Link href={toast.link.href} onClick={() => onClose(toast.id)}>{toast.link.label}</Link>}
    </div>
    <button type="button" className="toastClose" aria-label="Close" onClick={() => onClose(toast.id)}><X size={15} /></button>
  </div>;
}
