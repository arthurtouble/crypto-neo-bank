"use client";

import { useState } from "react";

export function PaymentActions({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="button primary" type="button" onClick={async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }}>{copied ? "Copied" : "Copy address"}</button>;
}
