import { z } from "zod";

export const providerEventSchema = z.object({
  id: z.string().min(3).max(160),
  provider: z.enum(["bridge", "privy", "rain", "demo"]),
  type: z.string().min(3).max(120),
  subjectReference: z.string().min(3).max(160).optional(),
  providerObjectId: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  data: z.record(z.string(), z.unknown()).default({})
});

export type ProviderEvent = z.infer<typeof providerEventSchema>;
export type ProviderEventMessage = {
  event: ProviderEvent;
  receivedAt: string;
  payloadSha256: string;
};

function fromHex(value: string): Uint8Array | null {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2) return null;
  return new Uint8Array(value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyProviderSignature(input: { rawBody: string; timestamp: string; signature: string; secret: string; toleranceSeconds: number; now?: number }): Promise<boolean> {
  const timestampSeconds = Number(input.timestamp);
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > input.toleranceSeconds) return false;
  const supplied = fromHex(input.signature.replace(/^v1=/, ""));
  if (!supplied) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(input.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${input.timestamp}.${input.rawBody}`)));
  return constantTimeEqual(supplied, expected);
}
