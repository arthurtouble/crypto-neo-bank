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

/**
 * What to tell the customer when Privy's add-email flow fails, by Privy's error code: what went wrong and what to do.
 * Closing the flow (`exited_link_flow`) isn't a failure, so it has no message.
 */
export function linkEmailFailure(code: string): string | null {
  if (code === "exited_link_flow") return null;
  if (code === "linked_to_another_user") return "That email is already on another Aura account. Add a different email, or log out and sign in with that one.";
  if (code === "too_many_requests") return "Too many tries. Wait a minute, then try again.";
  if (code === "invalid_credentials") return "That code didn't match. Add your email again to get a new code.";
  return "That email couldn't be added. Try again.";
}
