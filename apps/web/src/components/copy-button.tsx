"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useToast } from "./toast";

type Props = {
  /** What goes on the clipboard. */
  value: string;
  /** The button's text: "Copy address", or "Copy" beside a labelled value. */
  label?: string;
  /** The accessible name when the text alone doesn't say what is copied: "Copy account number". */
  ariaLabel?: string;
  className?: string;
};

/**
 * Copies a value and says so in place ("Copied"). The clipboard can be refused
 * (permissions, an insecure page); then it says "Couldn't copy" and, inside
 * the app, a toast explains how to copy it by hand. The value stays on screen.
 */
export function CopyButton({ value, label = "Copy", ariaLabel, className = "appButton" }: Props) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    window.clearTimeout(timer.current);
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
      toast.error("Couldn't copy", "Select the text and copy it instead.");
    }
    timer.current = window.setTimeout(() => setState("idle"), 1600);
  }
  return <><button type="button" className={className} aria-label={ariaLabel} onClick={() => void copy()}>
    {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
  </button><span className="srOnly" role="status">{state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : ""}</span></>;
}
