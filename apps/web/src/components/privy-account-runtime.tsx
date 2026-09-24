"use client";

import { LogIn, LogOut } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";

export default function PrivyAccountRuntime() {
  const { authenticated, login, logout, ready } = usePrivy();

  return (
    <button
      className="privyAccountButton"
      type="button"
      disabled={!ready}
      onClick={() => void (authenticated ? logout() : login())}
      aria-label={authenticated ? "Log out of Aura" : "Sign in to Aura"}
    >
      {authenticated ? <LogOut size={14} /> : <LogIn size={14} />}
      <span>{authenticated ? "Log out" : "Sign in"}</span>
    </button>
  );
}
