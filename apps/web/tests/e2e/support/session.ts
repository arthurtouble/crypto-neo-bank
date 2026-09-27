import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { aTokenFor, OPERATOR } from "./fake-edge.mjs";

// The dev server drops idle keep-alive sockets after a few seconds; a fresh connection per setup call can't race that.
const fresh = { Connection: "close" };

const edgeUrl = `http://127.0.0.1:${process.env.AUREL_E2E_EDGE_PORT ?? "43174"}`;

export const ASSETS = {
  usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  weth: "0x4200000000000000000000000000000000000006",
  cbbtc: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
  aaveUsdc: aTokenFor("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
  aaveWeth: aTokenFor("0x4200000000000000000000000000000000000006"),
  eurc: "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
  apple: "0xb200000000000000000000c2e324d24d7eecd1fb",
  // Tether Gold, held on Ethereum.
  xaut: "0x68749665ff8d2d112fa859aa293f07a622782f38"
} as const;

/** Change what the fake Privy, chains, and price feed return. */
export async function edge(path: "/__reset" | "/__state" | "/__session" | "/__sent" | "/__balances" | "/__receive", body: unknown = {}) {
  const response = await fetch(`${edgeUrl}${path}`, { method: "POST", body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`fake edge ${path} failed: ${response.status}`);
  return response.json() as Promise<{ token?: string; sent?: Array<{ hash: string; chainId: number; from: string; to: string; data: string; value: string; success: boolean;
    relayed?: boolean; calls?: Array<{ to: string; data: string; value: string }> }> }>;
}

export type Customer = { userId: string; wallet: `0x${string}`; email: string; token: string; externalWallets: `0x${string}`[] };

/** A new customer with their own Privy account and embedded wallet, unique to the test. */
export async function newCustomer(options: { mfa?: string[]; expiresIn?: number; connectedWallet?: boolean } = {}): Promise<Customer> {
  const id = randomUUID().replaceAll("-", "");
  const externalWallets = options.connectedWallet ? [`0x${id.split("").reverse().join("").padEnd(40, "1").slice(0, 40)}` as `0x${string}`] : [];
  const customer = { userId: `did:privy:${id}`, wallet: `0x${id.padEnd(40, "0").slice(0, 40)}` as `0x${string}`, email: `${id.slice(0, 8)}@example.com`, externalWallets };
  await edge("/__state", { users: { [OPERATOR.userId]: { wallet: OPERATOR.wallet },
    [customer.userId]: { wallet: customer.wallet, email: customer.email, mfa: options.mfa ?? [], externalWallets } } });
  const { token } = await edge("/__session", { userId: customer.userId, expiresIn: options.expiresIn });
  return { ...customer, token: token! };
}

/** Set on-chain balances for a wallet, leaving other wallets' alone. Amounts are raw units, per chain and token (or "native"). */
export async function setBalances(wallet: string, balances: Partial<Record<1 | 10 | 137 | 8453 | 42161, Record<string, string>>>) {
  const entries = Object.entries(balances).flatMap(([chainId, tokens]) =>
    Object.entries(tokens ?? {}).map(([token, amount]) => ({ chainId: Number(chainId), token, owner: wallet, amount })));
  await edge("/__balances", entries);
}

/**
 * Give the browser the identity Privy would return. With `signedIn`, the
 * customer starts signed in; otherwise they sign in with the page's button.
 */
export async function setIdentity(page: Page, customer: Customer, options: { signedIn?: boolean } = {}) {
  await page.addInitScript(({ session, signedIn }) => {
    localStorage.setItem("aura-e2e-session", JSON.stringify(session));
    if (signedIn) localStorage.setItem("aura-e2e-signed-in", "1");
  }, { session: { userId: customer.userId, token: customer.token, wallet: customer.wallet, email: customer.email, externalWallets: customer.externalWallets },
    signedIn: options.signedIn ?? false });
}

/** Accept the current terms through the API, as a returning customer already has. */
export async function acceptTerms(page: Page, customer: Customer) {
  const current = await page.request.get("/api/terms", { headers: { Authorization: `Bearer ${customer.token}`, ...fresh } });
  const { documents } = await current.json() as { documents: Array<{ key: string; version: string }> };
  const version = (key: string) => documents.find((item) => item.key === key)!.version;
  const response = await page.request.post("/api/terms", { headers: { Authorization: `Bearer ${customer.token}`, ...fresh },
    data: { termsVersion: version("terms_of_use"), privacyVersion: version("privacy_notice") } });
  if (!response.ok()) throw new Error(`accepting terms failed: ${response.status()}`);
}

/** Turn a feature switch on or off through the operations API, as an operator would. */
export async function setFeature(page: Page, key: string, enabled: boolean) {
  const { token } = await edge("/__session", { userId: OPERATOR.userId });
  const response = await page.request.patch("/api/ops/features", { headers: { Authorization: `Bearer ${token}`, ...fresh }, data: { key, enabled } });
  if (!response.ok()) throw new Error(`setting ${key} failed: ${response.status()}`);
}

/** Call an Aura API as the customer, the way a screen would. */
export async function asCustomer(page: Page, customer: Customer, method: "GET" | "POST" | "PUT" | "PATCH", path: string, data?: unknown) {
  const response = await page.request.fetch(path, { method, headers: { Authorization: `Bearer ${customer.token}`, ...fresh }, data });
  if (!response.ok()) throw new Error(`${method} ${path} failed: ${response.status()} ${await response.text()}`);
  return response.json() as Promise<Record<string, unknown>>;
}
