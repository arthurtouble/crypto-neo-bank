import { getAddress, hexToBytes, isAddress, isHex } from "viem";

export type PreparedCallInput = {
  chainId: number;
  from: string;
  to: string;
  value: string | bigint;
  data: string;
};

export type NormalizedPreparedCall = {
  chainId: number;
  from: `0x${string}`;
  to: `0x${string}`;
  value: string;
  data: `0x${string}`;
  dataHash: `0x${string}`;
  fingerprint: `0x${string}`;
};

export type PreparedCallMatch =
  | { matches: true }
  | { matches: false; reason: "chain" | "from" | "to" | "value" | "data" | "invalid_observation" };

const MAX_UINT256 = (1n << 256n) - 1n;

async function sha256(bytes: Uint8Array): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function normalizePreparedCall(input: PreparedCallInput): Promise<NormalizedPreparedCall> {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error("Invalid chain ID.");
  if (!isAddress(input.from) || !isAddress(input.to)) throw new Error("Invalid transaction address.");
  const value = typeof input.value === "bigint" ? input.value : /^\d+$/.test(input.value) ? BigInt(input.value) : -1n;
  if (value < 0n || value > MAX_UINT256) throw new Error("Invalid transaction value.");
  if (!isHex(input.data, { strict: true }) || input.data.length % 2 !== 0) throw new Error("Invalid transaction calldata.");

  const from = getAddress(input.from);
  const to = getAddress(input.to);
  const data = input.data.toLowerCase() as `0x${string}`;
  const dataHash = await sha256(hexToBytes(data));
  const canonical = JSON.stringify([input.chainId, from.toLowerCase(), to.toLowerCase(), value.toString(), dataHash]);
  const fingerprint = await sha256(new TextEncoder().encode(canonical));
  return { chainId: input.chainId, from, to, value: value.toString(), data, dataHash, fingerprint };
}

export async function matchesPreparedCall(prepared: NormalizedPreparedCall, observed: PreparedCallInput): Promise<PreparedCallMatch> {
  let actual: NormalizedPreparedCall;
  try {
    actual = await normalizePreparedCall(observed);
  } catch {
    return { matches: false, reason: "invalid_observation" };
  }
  if (prepared.chainId !== actual.chainId) return { matches: false, reason: "chain" };
  if (prepared.from.toLowerCase() !== actual.from.toLowerCase()) return { matches: false, reason: "from" };
  if (prepared.to.toLowerCase() !== actual.to.toLowerCase()) return { matches: false, reason: "to" };
  if (prepared.value !== actual.value) return { matches: false, reason: "value" };
  if (prepared.dataHash !== actual.dataHash) return { matches: false, reason: "data" };
  return { matches: true };
}
