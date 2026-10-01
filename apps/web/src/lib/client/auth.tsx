"use client";

// Who is signed in, without loading Privy. Screens read sign-in state from here; the Privy runtime
// (components/web3-runtime-provider.tsx) is downloaded only for a saved session or when a guest signs in, and fills
// this context from Privy's hooks. Type-only imports from Privy cost nothing at runtime.
import type { User } from "@privy-io/react-auth";
import { createContext, useContext } from "react";

export type AuthUser = User;

export type AuthState = {
  /** False until Privy knows whether someone is signed in. A guest with no saved session is ready at once. */
  ready: boolean;
  authenticated: boolean;
  user: AuthUser | null;
  /** Open Privy's sign-in. For a guest this first loads Privy, then opens it. */
  login: () => void;
  logout: () => Promise<void>;
  /** The Privy access token for Aura's API, or null when signed out. */
  getAccessToken: () => Promise<string | null>;
};

const noop = () => undefined;

/** A visitor with no saved session: the labelled example data, and Sign in. */
export function guestAuth(login: () => void): AuthState {
  return { ready: true, authenticated: false, user: null, login, logout: async () => undefined, getAccessToken: async () => null };
}

export const AuthContext = createContext<AuthState>(guestAuth(noop));

/** Sign-in state and actions. Use this instead of Privy's `usePrivy`, so a page doesn't depend on Privy's code. */
export function useAuth(): AuthState {
  return useContext(AuthContext);
}
