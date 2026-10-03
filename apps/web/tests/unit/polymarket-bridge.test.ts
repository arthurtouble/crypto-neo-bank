import { decodeFunctionData, erc20Abi } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POLYMARKET_CONTRACTS } from "@/lib/markets/polymarket/http";
import { BASE_USDC, baseUsdcDepositMinimum, bridgeStatus, depositAddress, pusdTransferCall, withdrawAddress } from "@/lib/markets/polymarket/bridge";

const wallet = "0x4Fe2CC4925607a473264FA89e7138075695A5F8e";
const bridge = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const recipient = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

describe("Bridge addresses", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("asks for the wallet's deposit address", async () => {
    const fetcher = vi.fn(async () => Response.json({ address: { evm: bridge.toLowerCase(), svm: "So1ana", btc: "bc1" }, note: "x" })) as unknown as typeof fetch;
    await expect(depositAddress(wallet.toLowerCase(), { fetcher })).resolves.toBe(bridge);
    const [url, init] = vi.mocked(fetcher).mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://bridge.polymarket.com/deposit");
    expect(JSON.parse(init.body as string)).toEqual({ address: wallet });
    expect(init.headers["X-Builder-Code"]).toBeUndefined();
  });

  it("asks for a withdrawal address to Base USDC, with Aura's builder code once set", async () => {
    vi.stubEnv("POLYMARKET_BUILDER_CODE", `0x${"ab".repeat(32)}`);
    const fetcher = vi.fn(async () => Response.json({ address: { evm: bridge } })) as unknown as typeof fetch;
    await expect(withdrawAddress({ wallet, recipient: recipient.toLowerCase() }, { fetcher })).resolves.toBe(bridge);
    const [url, init] = vi.mocked(fetcher).mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://bridge.polymarket.com/withdraw");
    expect(JSON.parse(init.body as string)).toEqual({ address: wallet, toChainId: "8453", toTokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", recipientAddr: recipient });
    expect(init.headers["X-Builder-Code"]).toBe(`0x${"ab".repeat(32)}`);
    await expect(withdrawAddress({ wallet, recipient: "nope" }, { fetcher })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("reads the Base USDC minimum, and refuses when the bridge stops taking it", async () => {
    const assets = { supportedAssets: [
      { chainId: "1", chainName: "Ethereum", token: { name: "USD Coin", symbol: "USDC", address: "0xa0b8", decimals: 6 }, minCheckoutUsd: 7 },
      { chainId: "8453", chainName: "Base", token: { name: "USD Coin", symbol: "USDC", address: BASE_USDC, decimals: 6 }, minCheckoutUsd: 2 }
    ] };
    await expect(baseUsdcDepositMinimum({ fetcher: vi.fn(async () => Response.json(assets)) as unknown as typeof fetch })).resolves.toBe(2);
    const without = { supportedAssets: assets.supportedAssets.slice(0, 1) };
    await expect(baseUsdcDepositMinimum({ fetcher: vi.fn(async () => Response.json(without)) as unknown as typeof fetch })).rejects.toMatchObject({ code: "unsupported_asset" });
  });

  it("reads transfers seen at a bridge address", async () => {
    const fetcher = vi.fn(async () => Response.json({ transactions: [
      { fromChainId: "8453", fromTokenAddress: BASE_USDC, fromAmountBaseUnit: "5000000", toChainId: "137", toTokenAddress: POLYMARKET_CONTRACTS.pusd, status: "COMPLETED", txHash: `0x${"1".repeat(64)}`, createdTimeMs: 1791000000000 },
      { fromChainId: 8453, fromTokenAddress: BASE_USDC, fromAmountBaseUnit: 2000000, toChainId: 137, toTokenAddress: POLYMARKET_CONTRACTS.pusd, status: "DEPOSIT_DETECTED" }
    ] })) as unknown as typeof fetch;
    const transfers = await bridgeStatus(bridge, { fetcher });
    expect(transfers[0]).toEqual({ status: "COMPLETED", fromChainId: "8453", fromTokenAddress: BASE_USDC, fromAmountRaw: "5000000", toChainId: "137", toTokenAddress: POLYMARKET_CONTRACTS.pusd, txHash: `0x${"1".repeat(64)}`, createdAt: new Date(1791000000000).toISOString() });
    expect(transfers[1]).toMatchObject({ status: "DEPOSIT_DETECTED", fromAmountRaw: "2000000", txHash: null, createdAt: null });
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe(`https://bridge.polymarket.com/status/${bridge}?limit=50`);
  });
});

describe("Withdrawal transfer", () => {
  it("encodes a pUSD transfer for the wallet batch", () => {
    const call = pusdTransferCall(bridge, "2500000");
    expect(call).toMatchObject({ target: POLYMARKET_CONTRACTS.pusd, value: "0" });
    expect(decodeFunctionData({ abi: erc20Abi, data: call.data })).toEqual({ functionName: "transfer", args: [bridge, 2_500_000n] });
    expect(() => pusdTransferCall(bridge, "0")).toThrow();
    expect(() => pusdTransferCall(bridge, "1.5")).toThrow();
    expect(() => pusdTransferCall("nope", 1n)).toThrow();
  });
});
