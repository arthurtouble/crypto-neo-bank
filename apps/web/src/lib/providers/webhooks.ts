import { base64ToBytes, hmacSha256 } from "@/lib/platform/encoding";

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

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

const SVIX_TOLERANCE_MS = 5 * 60_000;

/**
 * A Svix-signed webhook (Privy and Resend deliver through Svix): HMAC-SHA256 over `<id>.<timestamp>.<body>` with the
 * base64 part of the `whsec_` secret, within five minutes. `svix-signature` may list several `v1,<sig>` values.
 */
export async function verifySvix({ headers, rawBody, secret, nowMs }: { headers: Headers; rawBody: string; secret: string; nowMs: number }) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp) || Math.abs(nowMs - Number(timestamp) * 1000) > SVIX_TOLERANCE_MS) return false;
  try {
    const expected = await hmacSha256(base64ToBytes(secret.replace(/^whsec_/, "")), `${id}.${timestamp}.${rawBody}`);
    return signatures.split(" ").some((entry) => {
      const [version, value] = entry.split(",", 2);
      try { return version === "v1" && Boolean(value) && timingSafeEqual(base64ToBytes(value), expected); } catch { return false; }
    });
  } catch { return false; }
}
