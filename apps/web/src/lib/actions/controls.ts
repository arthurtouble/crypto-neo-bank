import type { Controls } from "./store";
import type { BuiltAction } from "./types";
import type { Valuation } from "./valuation";

export type Block = { code: string; message: string };

/** The customer's own controls, applied to an action Aura prepares. Returns why it is blocked, or null. */
export function checkControls(action: BuiltAction, valuation: Valuation, controls: Controls): Block | null {
  if (controls.accountLocked) return { code: "account_locked", message: "Your account is locked. Unlock it in Settings to continue." };
  // Cooling only matters when sending is limited to saved recipients.
  if (action.recipient && controls.enforceAddressBook) {
    if (controls.recipient === "cooling") return { code: "recipient_cooling", message: "This saved recipient is still in its waiting period." };
    if (controls.recipient !== "saved") return { code: "recipient_not_saved", message: "Your settings only allow sending to saved recipients." };
  }
  if (action.countsTowardLimit && controls.dailyLimitCents !== null) {
    if (valuation.usdCents === null) return { code: "value_unavailable", message: "We couldn't value this amount, so we can't check it against your daily limit." };
    if (controls.spentUnknown) return { code: "recent_value_unavailable", message: "A recent transaction has no value, so we can't check your daily limit." };
    if (controls.spentCents + valuation.usdCents > controls.dailyLimitCents) return { code: "daily_limit", message: "This would go over your daily limit." };
  }
  return null;
}
