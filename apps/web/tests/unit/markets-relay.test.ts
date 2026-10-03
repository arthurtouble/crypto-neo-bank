import { encodeFunctionData, parseAbi } from "viem";
import { describe, expect, it } from "vitest";
import { buildPerpsDeposit } from "@/lib/markets/deposits";
import { RELAY_BASE_DEPOSITORY, quoteRelayPerpsDeposit, relayDeliveryStatus } from "@/lib/markets/relay";

const owner = "0x1111111111111111111111111111111111111111" as const;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const orderId = `0x${"96".repeat(32)}` as const;
const depositData = (depositor: string, amount: bigint) => encodeFunctionData({
  abi: parseAbi(["function depositErc20(address depositor, address token, uint256 amount, bytes32 id)"]),
  functionName: "depositErc20", args: [depositor as `0x${string}`, usdc, amount, orderId]
});

function quote(overrides: { depositor?: string; to?: string; recipient?: string; amount?: bigint } = {}) {
  const amount = overrides.amount ?? 8_000_000n;
  return {
    steps: [
      { id: "approve", items: [{ data: { to: usdc, value: "0", chainId: 8453, data: "0x095ea7b3" } }] },
      { id: "deposit", items: [{ data: { to: overrides.to ?? RELAY_BASE_DEPOSITORY, value: "0", chainId: 8453, data: depositData(overrides.depositor ?? owner, amount) } }] }
    ],
    details: {
      recipient: overrides.recipient ?? owner,
      currencyIn: { amount: amount.toString(), currency: { address: usdc, chainId: 8453 } },
      currencyOut: { amount: "797920000", minimumAmount: "793930400", currency: { address: "0x00000000000000000000000000000000", chainId: 1337 } }
    }
  };
}
const answering = (body: unknown) => (async () => Response.json(body)) as unknown as typeof fetch;

describe("quoting a Relay deposit into perps", () => {
  it("keeps Relay's deposit, writes its own exact approval, and counts the credit in 6 decimals", async () => {
    const result = await quoteRelayPerpsDeposit(owner, "8000000", { fetcher: answering(quote()) });
    expect(result.calls.map((call) => call.to)).toEqual([usdc, RELAY_BASE_DEPOSITORY]);
    expect(result.calls[0].data.startsWith("0x095ea7b3")).toBe(true);
    expect(result).toMatchObject({ creditRaw: "7979200", minimumCreditRaw: "7939304" });
  });

  it("refuses a quote that pays elsewhere, deposits for someone else, or sends to another account", async () => {
    for (const bad of [quote({ to: "0x2222222222222222222222222222222222222222" }), quote({ depositor: "0x3333333333333333333333333333333333333333" }),
      quote({ recipient: "0x4444444444444444444444444444444444444444" }), quote({ amount: 9_000_000n })]) {
      await expect(quoteRelayPerpsDeposit(owner, "8000000", { fetcher: answering(bad) })).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("builds the deposit through Relay when it quotes, marked for Relay's verification", async () => {
    const built = await buildPerpsDeposit(owner, "8", { balance: async () => undefined,
      relay: (address, raw) => quoteRelayPerpsDeposit(address, raw, { fetcher: answering(quote()) }) });
    expect(built).toMatchObject({ kind: "route", chainId: 8453, destinationChainId: 1337,
      effects: [{ type: "erc20_debit", amountRaw: "8000000" }, { type: "delivery", tool: "relay_direct", to: owner, minimumRaw: "7939304" }],
      summary: { tool: "relay_direct", toAmountRaw: "7979200", providerFeeRaw: "20800", market: "hyperliquid" } });
  });
});

describe("Relay's report on a deposit", () => {
  const hash = `0x${"ab".repeat(32)}`;
  const report = (status: string, recipient: string = owner) => answering({ requests: [{ status, recipient,
    data: { inTxs: [{ hash, chainId: 8453 }], outTxs: [{ hash: `0x${"cd".repeat(32)}`, chainId: 1337 }] } }] });
  it("names the Hyperliquid hash once filled, and tells refunds, failures, and other accounts apart", async () => {
    expect(await relayDeliveryStatus(hash, owner, { fetcher: report("success") })).toEqual({ state: "delivered", hyperliquidHash: `0x${"cd".repeat(32)}` });
    expect(await relayDeliveryStatus(hash, owner, { fetcher: report("pending") })).toEqual({ state: "pending" });
    expect(await relayDeliveryStatus(hash, owner, { fetcher: report("refund") })).toEqual({ state: "failed", reason: "refunded" });
    expect(await relayDeliveryStatus(hash, owner, { fetcher: report("success", "0x5555555555555555555555555555555555555555") })).toEqual({ state: "mismatch" });
    expect(await relayDeliveryStatus(hash, owner, { fetcher: answering({ requests: [] }) })).toEqual({ state: "pending" });
  });
});
