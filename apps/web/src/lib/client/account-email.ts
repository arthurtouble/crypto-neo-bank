import type { AuthUser } from "./auth";

/**
 * The email Aura uses for the account: the one added with Privy's one-time code, or else the Google sign-in's.
 * The server picks the same one when it sends (`privyEmail` in lib/auth/privy.ts). Every account has one before it
 * gets past the terms (components/terms-gate.tsx).
 */
export function accountEmail(user: AuthUser | null): { address: string; source: "email" | "google" } | null {
  if (user?.email?.address) return { address: user.email.address, source: "email" };
  if (user?.google?.email) return { address: user.google.email, source: "google" };
  return null;
}
