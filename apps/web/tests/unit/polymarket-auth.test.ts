import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import type { TypedData } from "@/lib/markets/types";
import { clobAuthTypedData, createOrDeriveApiKey, syncClobAllowance } from "@/lib/markets/polymarket/auth";
import { hmacSignature } from "@/lib/markets/polymarket/http";

// Hardhat's public test key #1; never a real account.
const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const timestamp = 1_791_000_000;
const signable = (typedData: TypedData) => {
  const types = Object.fromEntries(Object.entries(typedData.types).filter(([name]) => name !== "EIP712Domain"));
  return { ...typedData, types } as unknown as Parameters<typeof owner.signTypedData>[0];
};

describe("CLOB sign-in", () => {
  it("matches the SDK's ClobAuth hash and signature", async () => {
    const typed = clobAuthTypedData(owner.address, timestamp);
    // From the SDK's buildClobEip712Signature for the same owner, timestamp, and nonce 0.
    expect(hashTypedData(signable(typed))).toBe("0x11cce243cefee954dfff599829c0453cbcefc6c388f4d2b52eabb87310ed5a02");
    await expect(owner.signTypedData(signable(typed))).resolves.toBe("0x96cc2a5375a7094c69f9b0a1cc2f6e3adef6a05c47c07f74359fc28f4078c87050da84130ec5746c421697e7155daaf96a27232ff5904f251ade1456f1d623f81c");
    expect(() => clobAuthTypedData("0x12", timestamp)).toThrow();
  });

  it("creates the API key, or derives it when it already exists", async () => {
    const signature = await owner.signTypedData(signable(clobAuthTypedData(owner.address, timestamp)));
    const answers = [Response.json({ error: "Could not create api key" }, { status: 400 }), Response.json({ apiKey: "k", secret: "s", passphrase: "p" })];
    const fetcher = vi.fn(async () => answers.shift()) as unknown as typeof fetch;
    await expect(createOrDeriveApiKey({ ownerAddress: owner.address, signature, timestamp }, { fetcher })).resolves.toEqual({ key: "k", secret: "s", passphrase: "p" });
    const calls = vi.mocked(fetcher).mock.calls as unknown as Array<[string, RequestInit & { headers: Record<string, string> }]>;
    expect(calls.map(([url, init]) => `${init.method ?? "GET"} ${url}`)).toEqual(["POST https://clob.polymarket.com/auth/api-key", "GET https://clob.polymarket.com/auth/derive-api-key"]);
    expect(calls[1]?.[1].headers).toMatchObject({ POLY_ADDRESS: owner.address, POLY_NONCE: "0", POLY_SIGNATURE: signature, POLY_TIMESTAMP: String(timestamp) });
  });

  it("refuses a signature from anyone else before calling the CLOB", async () => {
    const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    const signature = await stranger.signTypedData(signable(clobAuthTypedData(owner.address, timestamp)));
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(createOrDeriveApiKey({ ownerAddress: owner.address, signature, timestamp }, { fetcher })).rejects.toMatchObject({ code: "invalid_signature" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks the CLOB to re-read allowances, signed with the owner's key", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const credentials = { key: "k", secret: "AAEC_-8=", passphrase: "p" };
    await syncClobAllowance({ credentials, ownerAddress: owner.address }, { type: "CONDITIONAL", tokenId: "123" }, { fetcher });
    const [url, init] = vi.mocked(fetcher).mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://clob.polymarket.com/balance-allowance/update?asset_type=CONDITIONAL&token_id=123&signature_type=3");
    expect(init.headers.POLY_ADDRESS).toBe(owner.address);
    const ts = Number(init.headers.POLY_TIMESTAMP);
    expect(Math.abs(ts - Math.floor(Date.now() / 1000))).toBeLessThan(5);
    expect(init.headers.POLY_SIGNATURE).toBe(await hmacSignature("AAEC_-8=", ts, "GET", "/balance-allowance/update"));
    await expect(syncClobAllowance({ credentials, ownerAddress: owner.address }, { type: "CONDITIONAL", tokenId: "x" }, { fetcher })).rejects.toMatchObject({ code: "invalid_request" });
  });
});
