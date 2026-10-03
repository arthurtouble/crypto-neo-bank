"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/lib/client/api";
import { AuthContext, guestAuth } from "@/lib/client/auth";
import { hasSavedPrivySession } from "@/lib/client/privy-session";
import { LoadingScreen } from "./states";
import { ToastProvider } from "./toast";

// Privy, its smart wallets, and wagmi are most of the app's JavaScript. They load only for a browser with a saved
// Privy session, or when a guest signs in; a guest browsing the example data never downloads them.
const loadRuntime = () => import("./web3-runtime-provider");
const Web3RuntimeProvider = lazy(loadRuntime);

// Once a session is seen it stays seen for this page load, so signing out keeps Privy loaded and in charge.
let sessionSeen = false;
const sessionSnapshot = () => (sessionSeen ||= hasSavedPrivySession());
const checking = () => null;
const subscribe = () => () => undefined;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    // A refused request (expired session, bad input) won't succeed on retry; a failed read might.
    defaultOptions: { queries: { staleTime: 12_000, refetchOnWindowFocus: false,
      retry: (failures, error) => failures < 2 && !(error instanceof ApiError && error.status < 500) } }
  }));
  // null while the server renders and the page hydrates: the same loading screen either way, so a returning customer
  // never sees the guest page flash first.
  const savedSession = useSyncExternalStore(subscribe, sessionSnapshot, checking);
  const [signingIn, setSigningIn] = useState(false);
  const [loginRequested, setLoginRequested] = useState(false);
  // From a guest's Sign in until Privy's sign-in opens: Privy is still downloading, so say so.
  const [opening, setOpening] = useState<"loading" | "failed" | null>(null);

  // A guest's Sign in: fetch the runtime while the page stays as it is, then mount it and open Privy's sign-in.
  const login = useCallback(() => {
    setOpening("loading");
    void loadRuntime().then(() => startTransition(() => { setLoginRequested(true); setSigningIn(true); }), () => setOpening("failed"));
  }, []);
  const onLoginOpened = useCallback(() => { setLoginRequested(false); setOpening(null); }, []);

  // A link with `?sign-in` (the landing's Sign in, a pay page's Send with Aura) opens sign-in on arrival for a guest, once
  // per address. The flag stays in the address: the app router can rewrite it during a navigation, and for a signed-in
  // customer it does nothing. Checked on each page this provider stays mounted for, since links between pages don't remount it.
  const pathname = usePathname();
  const signInHandled = useRef<string | null>(null);
  useEffect(() => {
    if (savedSession !== false || signInHandled.current === window.location.href) return;
    if (!new URLSearchParams(window.location.search).has("sign-in")) return;
    signInHandled.current = window.location.href;
    // After this render, as if the guest had pressed Sign in.
    queueMicrotask(login);
  }, [savedSession, login, pathname]);
  const guest = useMemo(() => guestAuth(login), [login]);

  const loading = <LoadingScreen label="Opening your account" />;
  const content = savedSession === null ? <LoadingScreen label="Loading" />
    : savedSession || signingIn ? <Web3RuntimeProvider loginRequested={loginRequested} onLoginOpened={onLoginOpened}>{children}</Web3RuntimeProvider>
      : <AuthContext.Provider value={guest}>{children}</AuthContext.Provider>;

  // One boundary for every state, so switching a guest to the runtime (in a transition) keeps their page on screen.
  return <QueryClientProvider client={queryClient}><ToastProvider><Suspense fallback={loading}>{content}</Suspense>
    {opening === "loading" && <div className="appSignInStatus" role="status"><LoaderCircle className="spin" aria-hidden="true" />Opening sign-in</div>}
    {opening === "failed" && <div className="appSignInStatus" role="alert">Sign-in couldn&apos;t load. Check your connection and try again.
      <button type="button" className="appButton appButtonSecondary" onClick={() => setOpening(null)}>Close</button></div>}
  </ToastProvider></QueryClientProvider>;
}
