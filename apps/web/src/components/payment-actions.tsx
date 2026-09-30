"use client";

import { CopyButton } from "./copy-button";

/** The Aura tag payment page's main action: copy the address to pay. */
export function PaymentActions({ address }: { address: string }) {
  return <CopyButton value={address} label="Copy address" className="appButton appButtonPrimary appButtonLarge" />;
}
