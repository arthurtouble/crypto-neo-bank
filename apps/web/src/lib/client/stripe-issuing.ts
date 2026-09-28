"use client";

/**
 * Stripe.js, only for showing the customer's own card in Stripe's frames and
 * adding it to a phone wallet. The card number never reaches Aura's code.
 */
export type IssuingElement = { mount: (target: string | HTMLElement) => void; destroy: () => void; on?: (event: string, handler: () => void) => void };
export type StripeIssuing = {
  createEphemeralKeyNonce: (input: { issuingCard: string }) => Promise<{ nonce?: string; error?: { message?: string } }>;
  retrieveIssuingCard: (cardId: string, input: { ephemeralKeySecret: string; nonce: string }) => Promise<{ error?: { message?: string } }>;
  elements: () => { create: (type: string, options: Record<string, unknown>) => IssuingElement };
};
declare global { interface Window { Stripe?: (key: string, options?: Record<string, unknown>) => StripeIssuing } }

let loading: Promise<void> | null = null;

export async function loadStripe(publishableKey: string): Promise<StripeIssuing> {
  loading ??= new Promise<void>((resolve, reject) => {
    if (window.Stripe) return resolve();
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { loading = null; reject(new Error("Stripe couldn't load.")); };
    document.head.appendChild(script);
  });
  await loading;
  if (!window.Stripe) throw new Error("Stripe couldn't load.");
  // Issuing Elements, and the Add to Wallet button (a Stripe preview).
  return window.Stripe(publishableKey, { betas: ["issuing_elements_2", "issuing_add_to_wallet_button_element_1"] });
}

export const cardElementStyle = { base: { fontSize: "16px", color: "#f5f3ee", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", letterSpacing: "0.04em" } };
