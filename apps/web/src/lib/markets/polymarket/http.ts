import { z } from "zod";
import { readBoundedJson } from "@/lib/http/bounded";
import { localEdgeUrl } from "@/lib/testing/local-edge";
import { VenueError } from "../types";

/**
 * Polymarket's HTTP surface for Aura: base URLs, request signing, and one
 * bounded, validated request helper. Polymarket is the venue of record: every
 * answer is read fresh, validated at this boundary, and never kept as proof.
 * Signing uses WebCrypto only, so it runs unchanged in a Cloudflare Worker.
 */

export const POLYGON_CHAIN_ID = 137;
export const ZERO_BYTES32 = `0x${"0".repeat(64)}` as const;

/** Production contracts, from the official SDK's `production` environment. */
export const POLYMARKET_CONTRACTS = {
  pusd: "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB",
  conditionalTokens: "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045",
  negRiskAdapter: "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296",
  collateralAdapter: "0xAdA100Db00Ca00073811820692005400218FcE1f",
  negRiskCollateralAdapter: "0xadA2005600Dec949baf300f4C6120000bDB6eAab",
  standardExchange: "0xE111180000d2663C0091e4f400237545B87B996B",
  negRiskExchange: "0xe2222d279d744050d28e00520010520000310F59",
  exchangeV3: "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa",
  protocolV2Router: "0x12121212006e4CD160D18e3f00711DA5c3372600",
  binaryModule: "0x1000008dD9001B968442c1000017eaE6E0dA00Ba",
  negRiskModule: "0x200000900045e3B6259600682756002200028933",
  positionManager: "0x006F54F7f9A22e0000CC2AB60031000000ae9fEF",
  autoRedeemOperator: "0xa1200000d0002264C9a1698e001292D00E1b00af",
  depositWalletFactory: "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07",
  depositWalletBeacon: "0x7A18EDfe055488A3128f01F563e5B479D92ffc3a"
} as const satisfies Record<string, `0x${string}`>;

type Service = "clob" | "gamma" | "data" | "relayer" | "bridge" | "web";

const BASE_URLS: Record<Service, { env: string; url: string }> = {
  clob: { env: "POLYMARKET_CLOB_URL", url: "https://clob.polymarket.com" },
  gamma: { env: "POLYMARKET_GAMMA_URL", url: "https://gamma-api.polymarket.com" },
  data: { env: "POLYMARKET_DATA_URL", url: "https://data-api.polymarket.com" },
  relayer: { env: "POLYMARKET_RELAYER_URL", url: "https://relayer-v2.polymarket.com" },
  bridge: { env: "POLYMARKET_BRIDGE_URL", url: "https://bridge.polymarket.com" },
  /** polymarket.com's own site API; undocumented, used only for the Up or Down price to beat. */
  web: { env: "POLYMARKET_WEB_URL", url: "https://polymarket.com" }
};

/** The production host, unless e2e points the service's env var at a loopback fake. */
export function polymarketUrl(service: Service): string {
  return localEdgeUrl(BASE_URLS[service].env) ?? BASE_URLS[service].url;
}

/** Credentials Polymarket hands out: a CLOB key for one customer, or Aura's Builder key. */
export type ApiCredentials = { key: string; secret: string; passphrase: string };

/**
 * Aura's Builder API key from Worker secrets. It authorizes gasless relayer
 * transactions (deploying a Deposit Wallet, wallet batches). Missing
 * secrets mean the feature is not configured, never a silent fallback.
 */
export function builderCredentials(env: Record<string, string | undefined> = process.env): ApiCredentials {
  const key = env.POLYMARKET_BUILDER_API_KEY, secret = env.POLYMARKET_BUILDER_SECRET, passphrase = env.POLYMARKET_BUILDER_PASSPHRASE;
  if (!key || !secret || !passphrase) throw new VenueError("polymarket", "not_configured", "Polymarket is not configured.", 503);
  return { key, secret, passphrase };
}

/** Aura's builder code for order attribution; zero unless set. Aura charges no builder fee. */
export function builderCode(env: Record<string, string | undefined> = process.env): `0x${string}` {
  const code = env.POLYMARKET_BUILDER_CODE;
  if (!code) return ZERO_BYTES32;
  if (!/^0x[\da-fA-F]{64}$/.test(code)) throw new VenueError("polymarket", "not_configured", "The Polymarket builder code is malformed.", 503);
  return code.toLowerCase() as `0x${string}`;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  // Secrets come base64 or base64url; the SDK accepts both, so this does too.
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/=]/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // URL-safe alphabet with padding kept, as Polymarket's servers compare it.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Polymarket's request HMAC: HMAC-SHA256 over `timestamp + method + path + body`
 * with the base64-decoded secret, encoded URL-safe base64 with padding. The
 * path excludes the query string; the body is the exact string sent.
 */
export async function hmacSignature(secret: string, timestamp: number, method: string, path: string, body?: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", base64ToBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}${method}${path}${body ?? ""}`));
  return bytesToBase64Url(new Uint8Array(signature));
}

const nowSeconds = (now: Date) => Math.floor(now.getTime() / 1000);

/** Builder headers for a relayer request (Aura's integration, not the customer). */
export async function builderHeaders(credentials: ApiCredentials, method: string, path: string, body?: string, now = new Date()): Promise<Record<string, string>> {
  const timestamp = nowSeconds(now);
  return {
    POLY_BUILDER_API_KEY: credentials.key,
    POLY_BUILDER_PASSPHRASE: credentials.passphrase,
    POLY_BUILDER_SIGNATURE: await hmacSignature(credentials.secret, timestamp, method, path, body),
    POLY_BUILDER_TIMESTAMP: String(timestamp)
  };
}

/** CLOB L2 headers: the customer's CLOB key, addressed as the owner wallet that created it. */
export async function l2Headers(credentials: ApiCredentials, ownerAddress: string, method: string, path: string, body?: string, now = new Date()): Promise<Record<string, string>> {
  const timestamp = nowSeconds(now);
  return {
    POLY_ADDRESS: ownerAddress,
    POLY_API_KEY: credentials.key,
    POLY_PASSPHRASE: credentials.passphrase,
    POLY_SIGNATURE: await hmacSignature(credentials.secret, timestamp, method, path, body),
    POLY_TIMESTAMP: String(timestamp)
  };
}

export type RequestOptions = { fetcher?: typeof fetch };

type RequestInput<S extends z.ZodType> = {
  service: Service;
  method?: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | readonly (string | number)[] | undefined>;
  body?: unknown;
  /** Headers that sign the exact method, path, and serialized body. */
  sign?: (method: string, path: string, body: string | undefined) => Promise<Record<string, string>>;
  headers?: Record<string, string>;
  schema: S;
  maxBytes?: number;
  /** For endpoints whose success body carries nothing used (it is not read at all). */
  ignoreBody?: boolean;
  fetcher?: typeof fetch;
};

const errorBody = z.object({ error: z.string().optional(), errorMsg: z.string().optional(), message: z.string().optional() }).passthrough();

async function rejectionMessage(response: Response): Promise<string> {
  const body = await readBoundedJson(response, 16_000).catch(() => null);
  const parsed = errorBody.safeParse(body);
  const message = parsed.success ? parsed.data.error ?? parsed.data.errorMsg ?? parsed.data.message : undefined;
  return message ? message.slice(0, 300) : `Polymarket answered HTTP ${response.status}.`;
}

/**
 * One request to a Polymarket service: 8 second timeout, bounded read, zod
 * validation of only the fields used. Any failure is a `VenueError`; a 4xx
 * keeps Polymarket's own message so callers can act on it (a stale nonce).
 */
export async function polymarketRequest<S extends z.ZodType>(input: RequestInput<S>): Promise<z.output<S>> {
  const method = input.method ?? "GET";
  const url = new URL(`${polymarketUrl(input.service)}${input.path}`);
  for (const [name, value] of Object.entries(input.query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) url.searchParams.append(name, String(item));
    else url.searchParams.set(name, String(value));
  }
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const headers: Record<string, string> = { accept: "application/json", ...input.headers };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (input.sign) Object.assign(headers, await input.sign(method, input.path, body));
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(url.toString(), { method, headers, body, signal: AbortSignal.timeout(8_000), cache: "no-store" });
  } catch {
    throw new VenueError("polymarket", "unavailable", "Polymarket did not answer.", 503);
  }
  if (!response.ok) {
    if (response.status === 429) {
      await response.body?.cancel().catch(() => undefined);
      throw new VenueError("polymarket", "rate_limited", "Polymarket is busy. Try again shortly.", 503);
    }
    if (response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      throw new VenueError("polymarket", "unavailable", `Polymarket answered HTTP ${response.status}.`, 503);
    }
    const message = await rejectionMessage(response);
    if (response.status === 404) throw new VenueError("polymarket", "not_found", message, 404);
    if (response.status === 401 || response.status === 403) throw new VenueError("polymarket", "unauthorized", message, 502);
    throw new VenueError("polymarket", "rejected", message, 422);
  }
  if (input.ignoreBody) {
    await response.body?.cancel().catch(() => undefined);
    return input.schema.parse(undefined);
  }
  const json = await readBoundedJson(response, input.maxBytes ?? 512_000).catch(() => {
    throw new VenueError("polymarket", "invalid_response", "Polymarket sent an unreadable answer.");
  });
  const parsed = input.schema.safeParse(json);
  if (!parsed.success) throw new VenueError("polymarket", "invalid_response", "Polymarket sent an unexpected answer.");
  return parsed.data;
}

/** zod helpers shared by the Polymarket modules. */
export const address = z.string().regex(/^0x[\da-fA-F]{40}$/).transform((value) => value.toLowerCase() as `0x${string}`);
export const uintString = z.string().regex(/^\d{1,78}$/);
export const decimalString = z.string().regex(/^\d+(\.\d+)?$/);
/** A JSON number or a decimal string, as Polymarket mixes both. */
export const numeric = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]).pipe(z.number().finite());
