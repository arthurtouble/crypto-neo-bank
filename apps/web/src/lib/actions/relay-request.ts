import { PRIVY_APP_ID } from "@/config/client";
import type { ActionAccount } from "@/lib/auth/wallet";
import { sendCallsRequest, type AuthorizationRequest } from "./privy-relay";
import type { StoredAction } from "./store";

/**
 * The Privy request for an action, rebuilt from what Aura stored when it
 * prepared the action. The customer signs this; the relay sends exactly this.
 */
export function actionRequest(action: StoredAction, account: ActionAccount): AuthorizationRequest | null {
  if (action.status !== "prepared" || action.wallet !== account.address) return null;
  return sendCallsRequest({ appId: PRIVY_APP_ID, walletId: account.walletId, chainId: action.chainId, calls: action.calls,
    idempotencyKey: `aura-action-${action.id}`, expiresAt: new Date(action.expiresAt) });
}
