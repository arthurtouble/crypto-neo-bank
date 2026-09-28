"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback } from "react";

export class ApiError extends Error {
  /** `body` is the full error response, for errors that carry more than a message (a passkey confirmation to sign). */
  constructor(readonly status: number, readonly code: string, message: string, readonly body: Record<string, unknown> = {}) { super(message); this.name = "ApiError"; }
}

/** Fetch an Aura API route with the customer's session, returning parsed JSON or throwing an ApiError. */
export function useApi() {
  const { getAccessToken } = usePrivy();
  return useCallback(async <T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> => {
    const token = await getAccessToken();
    if (!token) throw new ApiError(401, "unauthorized", "Your session expired. Sign in again.");
    const { json, ...rest } = init;
    const response = await fetch(path, {
      ...rest, cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body
    });
    const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
    // A closed account: every page but Support shows the closed notice (components/account-closed.tsx).
    if (response.status === 403 && body.error === "account_closed") window.dispatchEvent(new Event("aura:account-closed"));
    if (!response.ok) throw new ApiError(response.status, body.error ?? "request_failed", body.message ?? "Something went wrong. Try again.", body);
    return body as T;
  }, [getAccessToken]);
}
