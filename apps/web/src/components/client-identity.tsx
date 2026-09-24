"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";

function initials(value: string) {
  return value.split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A";
}

function compact(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Wallet preparing";
}

export function ClientIdentity() {
  const { authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const label = authenticated ? user?.email?.address ?? user?.google?.email ?? "Aura account" : "Explore Aura";

  return <div className="clientIdentity"><span className="avatar">{initials(label)}</span><span><strong>{label}</strong><small>{authenticated ? compact(wallet?.address) : "Guest view"}</small></span></div>;
}
