"use client";

import { Check, CircleAlert, Delete, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiError } from "@/lib/client/api";
import { useAction, type ActionView } from "@/lib/client/use-action";
import { formatTime, formatUsd } from "@/lib/format";
import { cleanDecimal, dayChangePercent, formatSignedPercent, pressKey, shareOf } from "@/lib/markets/view";
import type { Observed } from "./markets-data";

/** True below the phone breakpoint (768px), where amounts get a keypad and sheets come from the bottom. */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

/** Where a venue value came from and when: "From Hyperliquid at 3:12 PM". */
export function SourceLine({ source, observedAt, example }: { source: "hyperliquid" | "polymarket"; observedAt: string | null | undefined; example?: boolean }) {
  const name = source === "hyperliquid" ? "Hyperliquid" : "Polymarket";
  return <small className="mkSource">{example ? `Example data, shaped like ${name}'s` : observedAt ? `From ${name} at ${formatTime(observedAt)}` : `From ${name}`}</small>;
}

/** A day's change: positive in green with a plus, a fall in the normal text colour with a minus (never red, which means failed). */
export function Change({ price, prevDayPrice }: { price: string | number | null | undefined; prevDayPrice: string | number | null | undefined }) {
  const change = dayChangePercent(price, prevDayPrice);
  if (change === null) return <span className="appUnavailable">Unavailable</span>;
  return <span className={change > 0 ? "mkUp" : "mkFlat"}>{formatSignedPercent(change)}</span>;
}

/** A segmented control that switches a view or a choice in place. */
export function Segmented<T extends string>({ label, value, options, onChange, className }: {
  label: string; value: T; options: Array<{ value: T; label: React.ReactNode; disabled?: boolean }>; onChange: (value: T) => void; className?: string;
}) {
  return <div className={`mkSegmented${className ? ` ${className}` : ""}`} role="radiogroup" aria-label={label}>
    {options.map((option) => <button type="button" role="radio" key={option.value} aria-checked={value === option.value} disabled={option.disabled}
      onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

/** Tabs that switch what a list shows (Positions, Orders, History). */
export function ListTabs<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ value: T; label: string; count?: number }>; onChange: (value: T) => void;
}) {
  return <div className="mkListTabs" role="tablist" aria-label={label}>
    {options.map((option) => <button type="button" role="tab" key={option.value} aria-selected={value === option.value} onClick={() => onChange(option.value)}>
      {option.label}{option.count ? <span className="mkCount">{option.count}</span> : null}</button>)}
  </div>;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "delete"];

/**
 * A dollar amount with 25%, 50%, and Max of what's available. On the phone the
 * amount is large and a keypad enters it, so the system keyboard stays closed.
 */
export function DollarAmount({ label, value, onChange, available, maxLabel = "Max", shares = [0.25, 0.5], aside, note, error, describedBy }: {
  label: string; value: string; onChange: (value: string) => void; available: number | null; maxLabel?: string;
  /** The shortcuts before Max, as fractions of what's available. */
  shares?: number[];
  /** A note beside the label, such as what's available. */
  aside?: React.ReactNode;
  /** A line under the shortcuts, such as what else Max counts. */
  note?: React.ReactNode;
  error?: string | null; describedBy?: string;
}) {
  const phone = useIsPhone();
  const id = useId();
  const errorId = `${id}-error`;
  const shortcuts: Array<[string, number]> = [...shares.map((share): [string, number] => [`${Math.round(share * 100)}%`, share]), [maxLabel, 1]];
  return <div className="mkAmount">
    <label className="mkAmountField" htmlFor={id}>
      <span className="mkLabelRow"><span className="mkLabel">{label}</span>{aside ? <small>{aside}</small> : null}</span>
      <span className="mkAmountInput"><span aria-hidden="true">$</span>
        <input id={id} value={value} inputMode={phone ? "none" : "decimal"} autoComplete="off" placeholder="0" aria-invalid={error ? true : undefined}
          aria-describedby={[error ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined}
          onChange={(event) => onChange(cleanDecimal(event.target.value, 2))} /></span>
    </label>
    <div className="mkShares" role="group" aria-label="Amount shortcuts">
      {shortcuts.map(([name, fraction]) =>
        <button type="button" key={name} className="mkChip" disabled={!available || available <= 0} onClick={() => onChange(shareOf(available ?? 0, fraction))}>{name}</button>)}
    </div>
    {note && <p className="mxHint mkAmountNote">{note}</p>}
    {error && <p className="mxFieldError" id={errorId}>{error}</p>}
    {phone && <div className="mkKeypad" role="group" aria-label="Keypad">
      {KEYS.map((key) => <button type="button" key={key} aria-label={key === "delete" ? "Delete" : key} onClick={() => onChange(pressKey(value, key))}>
        {key === "delete" ? <Delete aria-hidden="true" /> : key}</button>)}
    </div>}
  </div>;
}

/** "Pay with USDC": the Aura account on Base that pays, and what it holds. */
export function PayWith({ amount, note }: { amount: number | null; note?: React.ReactNode }) {
  return <div className="mkPayWith">
    <span className="mkPayToken" aria-hidden="true">$</span>
    <span className="mkPayText"><strong>Pay with USDC</strong><small>Your Aura account on Base{note ? <> · {note}</> : null}</small></span>
    <span className="mkPayAmount">{amount === null ? <span className="appUnavailable">Unavailable</span> : formatUsd(amount)}</span>
  </div>;
}

export type FlowStep = { key: string; label: string; detail?: string };
export type FlowState = { steps: FlowStep[]; current: number; failed: string | null; done: string | null };

/** A trade's steps as a timeline in place: done ones checked, the current one with a spinner, a failure in words. */
export function FlowTimeline({ flow, title }: { flow: FlowState; title: string }) {
  return <div className="mkFlow" role={flow.failed ? "alert" : "status"} aria-live="polite" aria-label={title}>
    <ol>
      {flow.steps.map((step, index) => {
        const state = flow.done !== null || index < flow.current ? "done" : index === flow.current ? (flow.failed ? "failed" : "active") : "todo";
        return <li key={step.key} className={`mkFlowStep is-${state}`}>
          <i aria-hidden="true">{state === "done" ? <Check /> : state === "active" ? <LoaderCircle className="spin" /> : state === "failed" ? <CircleAlert /> : null}</i>
          <span><strong>{step.label}</strong>{step.detail && state !== "todo" ? <small>{step.detail}</small> : null}</span>
        </li>;
      })}
    </ol>
    {flow.done && <p className="mkFlowDone"><strong>{flow.done}</strong></p>}
    {flow.failed && <p className="mkFlowFailed">{flow.failed}</p>}
  </div>;
}

/** Drives a FlowTimeline: start with the steps, move through them, and finish or fail. */
export function useFlow() {
  const [flow, setFlow] = useState<FlowState | null>(null);
  const start = useCallback((steps: FlowStep[]) => setFlow({ steps, current: 0, failed: null, done: null }), []);
  const at = useCallback((key: string, detail?: string) => setFlow((current) => current && {
    ...current, current: Math.max(0, current.steps.findIndex((step) => step.key === key)),
    steps: detail === undefined ? current.steps : current.steps.map((step) => step.key === key ? { ...step, detail } : step)
  }), []);
  const finish = useCallback((message: string) => setFlow((current) => current && { ...current, current: current.steps.length, done: message }), []);
  const fail = useCallback((message: string) => setFlow((current) => current && { ...current, failed: message }), []);
  const reset = useCallback(() => setFlow(null), []);
  return { flow, start, at, finish, fail, reset, running: flow !== null && !flow.failed && !flow.done };
}

/** What a failed step says: the customer cancelling, an expired session, or the server's own words. */
export function failureMessage(error: unknown): string {
  if (error instanceof Error && /reject|denied|cancel|exited/i.test(error.message) && !(error instanceof ApiError)) return "You cancelled. Nothing more was sent.";
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Something went wrong. Try again.";
}

/**
 * A money action (moving USDC into a venue account) through the app's own
 * action flow, as a promise: it resolves once the action settles, and rejects
 * if it's cancelled, refused, or fails. Its progress shows on TransactionProgress.
 */
export function useSettledAction(label: string) {
  const pending = useRef<{ resolve: (action: ActionView) => void; reject: (error: Error) => void } | null>(null);
  const action = useAction({ label, onSettled: (settled) => {
    const waiting = pending.current;
    pending.current = null;
    if (!waiting) return;
    if (settled.status === "failed" || settled.status === "expired") waiting.reject(new Error("Adding money didn't go through. Nothing else was sent."));
    else waiting.resolve(settled);
  } });
  useEffect(() => {
    if (action.phase === "idle" && action.error && pending.current) {
      const waiting = pending.current;
      pending.current = null;
      waiting.reject(new Error(action.error));
    }
  }, [action.phase, action.error]);
  const runAndWait = useCallback((prepare: () => Promise<ActionView>) => new Promise<ActionView>((resolve, reject) => {
    pending.current = { resolve, reject };
    void action.runPrepared(prepare);
  }), [action]);
  return { ...action, runAndWait };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A value read from a venue, or "Unavailable" in its place. */
export function ObservedValue<T>({ value, render }: { value: Observed<T> | null | undefined; render: (data: T) => React.ReactNode }) {
  if (!value || value.status !== "observed") return <span className="appUnavailable">Unavailable</span>;
  return <>{render(value.data)}</>;
}

/** The section when its switch is off. */
export function NotAvailableYet({ name }: { name: "Perps" | "Predictions" }) {
  return <section className="mkEmpty" data-testid="markets-switched-off">
    <h2>{name} aren&apos;t available yet</h2>
    <p>We&apos;re getting {name.toLowerCase()} ready. They&apos;ll appear here when they open.</p>
  </section>;
}
