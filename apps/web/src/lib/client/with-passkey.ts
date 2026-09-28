"use client";

import type { AuthorizationRequest } from "@/lib/actions/privy-relay";
import { ApiError } from "./api";

/**
 * Send a request that may need a fresh passkey confirmation. When the server
 * answers 428, the customer signs its challenge with their passkey and the
 * request is sent again with the confirmation.
 */
export async function withPasskey<T>(send: (confirmation?: { challengeId: string; signature: string }) => Promise<T>,
  authorize: (request: AuthorizationRequest<unknown>) => Promise<string>): Promise<T> {
  try { return await send(); }
  catch (error) {
    if (!(error instanceof ApiError) || error.code !== "confirmation_required") throw error;
    const { challengeId, request } = error.body as { challengeId: string; request: AuthorizationRequest<unknown> };
    return send({ challengeId, signature: await authorize(request) });
  }
}
