/** A provider event after signature checks, in the shape the events Worker applies. */
export type NormalizedEvent = {
  id: string;
  type: string;
  providerObjectId: string;
  createdAt: string;
  data: Record<string, unknown>;
  /** How to find the Aura customer: directly, or through the provider's customer ID. */
  subject: { kind: "subject"; value: string } | { kind: "provider_customer"; value: string } | { kind: "provider_onboarding"; value: string }
    | { kind: "provider_card"; value: string } | null;
};

export type WebhookProvider = {
  name: "bridge" | "privy" | "stripe";
  /** The secret the signature is checked against. Absent means the provider is not connected. */
  secret: () => string | undefined;
  verify: (input: { headers: Headers; rawBody: string; secret: string; nowMs: number }) => Promise<boolean>;
  normalize: (payload: unknown, headers: Headers) => NormalizedEvent | null;
};

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}
