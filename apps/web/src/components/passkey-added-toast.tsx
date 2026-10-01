"use client";

import { useAuth } from "@/lib/client/auth";
import { useEffect, useRef } from "react";
import { MFA_REQUIRED_TOAST } from "@/lib/client/use-action";
import { useToast } from "./toast";

/** Confirm when the customer adds a passkey or authenticator app, and clear the prompt that asked for one. */
export function PasskeyAddedToast() {
  const { ready, authenticated, user } = useAuth();
  const toast = useToast();
  const methods = user?.mfaMethods ?? [];
  const hasPasskey = methods.includes("passkey");
  const enrolled = hasPasskey || methods.includes("totp");
  const previous = useRef<boolean | null>(null);

  useEffect(() => {
    if (!ready || !authenticated) { previous.current = null; return; }
    if (previous.current === false && enrolled) {
      toast.dismiss(MFA_REQUIRED_TOAST);
      toast.success(hasPasskey ? "Passkey added" : "Authenticator app added", "You can move money now.");
    }
    previous.current = enrolled;
  }, [ready, authenticated, enrolled, hasPasskey, toast]);

  return null;
}
