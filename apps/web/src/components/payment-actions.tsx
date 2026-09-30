"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function PaymentActions({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="appButton appButtonPrimary appButtonLarge" type="button" onClick={async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? "Copied" : "Copy address"}</button>;
}
