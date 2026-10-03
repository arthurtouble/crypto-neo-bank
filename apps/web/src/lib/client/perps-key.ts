"use client";

import type { TypedData } from "@/lib/markets/types";

/**
 * This device's Perps trading key, one per wallet. It is made and kept in
 * the browser; Aura's server never sees it. The customer's wallet approves it
 * on Hyperliquid once, with the passkey, and from then on it signs orders,
 * cancels, and leverage changes here. Hyperliquid never lets it move money
 * out of the account.
 *
 * The key is stored in IndexedDB encrypted with an AES key the browser won't
 * export, so a copy of the site's storage alone doesn't give it away.
 */
const DATABASE = "aura-perps";
const signer = () => import("@/lib/markets/device-signer");
const STORE = "trading-keys";

type Stored = { owner: string; address: `0x${string}`; wrapKey: CryptoKey; iv: Uint8Array; ciphertext: ArrayBuffer };
export type DeviceKey = { address: `0x${string}`; sign: (typedData: TypedData) => Promise<`0x${string}`> };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "owner" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("This browser can't keep a trading key."));
  });
}

async function run<T>(mode: IDBTransactionMode, query: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = query(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("This browser can't keep a trading key."));
    });
  } finally { db.close(); }
}

const toKey = (stored: Stored): DeviceKey => ({
  address: stored.address,
  async sign(typedData) {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: stored.iv as BufferSource }, stored.wrapKey, stored.ciphertext);
    return (await signer()).signTypedData(new TextDecoder().decode(plain) as `0x${string}`, typedData);
  }
});

/** This device's trading key for `owner`, or null if it has none yet. */
export async function deviceKey(owner: string): Promise<DeviceKey | null> {
  const stored = await run<Stored | undefined>("readonly", (store) => store.get(owner.toLowerCase()));
  return stored ? toKey(stored) : null;
}

/** This device's trading key for `owner`, made now if it has none. */
export async function ensureDeviceKey(owner: string): Promise<DeviceKey> {
  const existing = await deviceKey(owner);
  if (existing) return existing;
  const { addressOf, newPrivateKey } = await signer();
  const privateKey = newPrivateKey();
  const wrapKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, new TextEncoder().encode(privateKey));
  const stored: Stored = { owner: owner.toLowerCase(), address: addressOf(privateKey), wrapKey, iv, ciphertext };
  await run("readwrite", (store) => store.put(stored));
  return toKey(stored);
}
