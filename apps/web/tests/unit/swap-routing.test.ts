import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData, formatUnits } from "viem";
import { createLifiQuoteAdapter } from "@/lib/swap/lifi";
import { LIFI_ACROSS_V4_ABI, LIFI_ERC20_SWAP_ABI, LIFI_FEE_FORWARDER_ABI } from "@/lib/swap/lifi-diamond-inspection";
import type { CatalogAsset } from "@/lib/swap/assets";

const wallet = "0x1111111111111111111111111111111111111111";
const approvalTarget = "0x2222222222222222222222222222222222222222";
const routeTarget = "0x3333333333333333333333333333333333333333";
const baseUsdc: CatalogAsset = {
  id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453,
  address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin",
  decimals: 6, logoUrl: null, verification: "verified", eligibility: "eligible"
};
const baseEth: CatalogAsset = {
  id: "8453:native", chainId: 8453, address: null, symbol: "ETH", name: "Ether",
  decimals: 18, logoUrl: null, verification: "verified", eligibility: "eligible"
};
const baseWeth: CatalogAsset = { ...baseEth, id: "8453:0x4200000000000000000000000000000000000006",
  address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether" };
const mainnetEth: CatalogAsset = { ...baseEth, id: "1:native", chainId: 1 };
const arbitrumUsdc: CatalogAsset = { ...baseUsdc,
  id: "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831", chainId: 42161,
  address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" };

type ProviderQuote = ReturnType<typeof lifiQuote>;

function lifiQuote() {
  return {
    id: "quote-1", tool: "1inch",
    action: {
      fromChainId: 8453, toChainId: 8453,
      fromAmount: "1000000", fromAddress: wallet, toAddress: wallet, slippage: 0.005,
      fromToken: { symbol: "USDC", decimals: 6, chainId: 8453, address: baseUsdc.address! },
      toToken: { symbol: "ETH", decimals: 18, chainId: 8453, address: "0x0000000000000000000000000000000000000000" }
    },
    estimate: {
      fromAmount: "1000000", toAmount: "300000000000000", toAmountMin: "290000000000000",
      approvalAddress: approvalTarget, fromAmountUSD: "1", toAmountUSD: "0.99"
    },
    transactionRequest: { to: routeTarget, data: "0x1234", value: "0", chainId: 8453 },
    expiresAt: undefined as string | undefined
  };
}

function adapter(payload: unknown) {
  return adapterWithFetcher(vi.fn(async () => Response.json(payload)));
}

function adapterWithFetcher(fetcher: typeof fetch) {
  return createLifiQuoteAdapter({
    fetcher,
    now: () => Date.parse("2026-09-22T12:00:00.000Z"),
    policy: {
      allowedTools: new Set(["1inch", "across"]),
      allowedExchanges: new Set(["1inch", "0x"]),
      allowedBridges: new Set(["across"]),
      allowedTargets: new Set([routeTarget.toLowerCase()]),
      allowedApprovalTargets: new Set([approvalTarget.toLowerCase()])
    }
  });
}

function compositeQuote() {
  const sourceToken = lifiQuote().action.fromToken;
  const destinationToken = { symbol: "WETH", decimals: 18, chainId: 8453, address: baseWeth.address! };
  const action = { fromChainId: 8453, toChainId: 8453, fromAmount: "1000000", fromAddress: wallet,
    toAddress: wallet, slippage: 0.005, fromToken: sourceToken, toToken: destinationToken };
  const innerAction = { ...action, fromAddress: routeTarget, toAddress: routeTarget,
    jitoBundle: false, integratorId: "aurel", integratorFees: { feePercent: 0.0025 } };
  const feeCall = encodeFunctionData({ abi: LIFI_FEE_FORWARDER_ABI, functionName: "forwardERC20Fees",
    args: [baseUsdc.address! as `0x${string}`, [{ recipient: approvalTarget as `0x${string}`, amount: 2_500n }]] });
  const sourceData = encodeFunctionData({ abi: LIFI_ERC20_SWAP_ABI,
    functionName: "swapTokensMultipleV3ERC20ToERC20", args: [
      `0x${"ab".repeat(32)}`, "aurel", "", wallet as `0x${string}`, 290_000_000_000_000n,
      [
        { callTo: approvalTarget as `0x${string}`, approveTo: approvalTarget as `0x${string}`,
          sendingAssetId: baseUsdc.address! as `0x${string}`,
          receivingAssetId: baseUsdc.address! as `0x${string}`, fromAmount: 1_000_000n,
          callData: feeCall, requiresDeposit: true },
        { callTo: routeTarget as `0x${string}`, approveTo: routeTarget as `0x${string}`,
          sendingAssetId: baseUsdc.address! as `0x${string}`,
          receivingAssetId: baseWeth.address! as `0x${string}`, fromAmount: 997_500n,
          callData: "0x3f0bde25", requiresDeposit: false }
      ]
    ] });
  return { ...lifiQuote(), type: "lifi", tool: "nordstern", action,
    estimate: { ...lifiQuote().estimate, toAmount: "300000000000000", toAmountMin: "290000000000000",
      feeCosts: [{ amount: "2500", amountUSD: "0.0025", included: true, token: sourceToken }] },
    transactionRequest: { to: routeTarget, from: wallet, data: sourceData, value: "0x0", chainId: 8453,
      gasLimit: "0x493e0", gasPrice: "0x989680" },
    includedSteps: [
      { id: "fee-1", type: "protocol", tool: "feeCollection",
        action: { ...innerAction, toToken: sourceToken },
        estimate: { fromAmount: "1000000", toAmount: "997500", toAmountMin: "997500",
          feeCosts: [{ amount: "2500", included: true, token: sourceToken }] } },
      { id: "swap-1", type: "swap", tool: "nordstern",
        action: { ...innerAction, fromAmount: "997500" },
        estimate: { fromAmount: "997500", toAmount: "300000000000000", toAmountMin: "290000000000000" } }
    ]
  };
}

function compositeAdapter(payload: unknown) {
  return createLifiQuoteAdapter({ fetcher: vi.fn(async () => Response.json(payload)),
    now: () => Date.parse("2026-09-22T12:00:00.000Z"), policy: {
      allowedTools: new Set(["nordstern", "feecollection"]), allowedExchanges: new Set(["nordstern"]),
      allowedBridges: new Set(), allowedTargets: new Set([routeTarget.toLowerCase()]),
      allowedApprovalTargets: new Set([approvalTarget.toLowerCase()])
    } });
}

function acrossCompositeQuote() {
  const original = compositeQuote();
  const sourceToken = original.action.fromToken;
  const destinationToken = { ...sourceToken, chainId: 42161, address: arbitrumUsdc.address! };
  const word = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}` as `0x${string}`;
  const gross = 1_000_000n;
  const net = 997_500n;
  const multiplier = 999_822_977_443_609_023n;
  const output = net * multiplier / 1_000_000_000_000_000_000n;
  const feeCall = encodeFunctionData({ abi: LIFI_FEE_FORWARDER_ABI, functionName: "forwardERC20Fees",
    args: [baseUsdc.address! as `0x${string}`, [{ recipient: approvalTarget as `0x${string}`, amount: 2_500n }]] });
  const data = encodeFunctionData({ abi: LIFI_ACROSS_V4_ABI,
    functionName: "swapAndStartBridgeTokensViaAcrossV4", args: [
      { transactionId: `0x${"ab".repeat(32)}` as `0x${string}`, bridge: "across", integrator: "aurel",
        referrer: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        sendingAssetId: baseUsdc.address! as `0x${string}`,
        receiver: wallet as `0x${string}`, minAmount: net, destinationChainId: 42161n,
        hasSourceSwaps: true, hasDestinationCall: false },
      [{ callTo: approvalTarget as `0x${string}`, approveTo: approvalTarget as `0x${string}`,
        sendingAssetId: baseUsdc.address! as `0x${string}`,
        receivingAssetId: baseUsdc.address! as `0x${string}`, fromAmount: gross,
        callData: feeCall, requiresDeposit: true }],
      { receiverAddress: word(wallet), refundAddress: word(wallet),
        sendingAssetId: word(baseUsdc.address!), receivingAssetId: word(arbitrumUsdc.address!),
        outputAmount: output, outputAmountMultiplier: multiplier,
        exclusiveRelayer: `0x${"00".repeat(32)}` as `0x${string}`,
        quoteTimestamp: 1_790_078_400, fillDeadline: 1_790_082_000,
        exclusivityParameter: 0, message: "0x" }
    ] });
  return { ...original, tool: "across", action: { ...original.action, toChainId: 42161, toToken: destinationToken },
    estimate: { ...original.estimate, toAmount: output.toString(), toAmountMin: "995000" },
    transactionRequest: { ...original.transactionRequest, data },
    includedSteps: [original.includedSteps[0], {
      ...original.includedSteps[1], type: "cross", tool: "across",
      action: { ...original.includedSteps[1].action, toChainId: 42161,
        toToken: destinationToken, toAddress: wallet },
      estimate: { ...original.includedSteps[1].estimate,
        toAmount: output.toString(), toAmountMin: "995000" }
    }] };
}

function acrossCompositeAdapter(payload: unknown) {
  return createLifiQuoteAdapter({ fetcher: vi.fn(async () => Response.json(payload)),
    now: () => Date.parse("2026-09-22T12:00:00.000Z"), policy: {
      allowedTools: new Set(["across", "feecollection"]), allowedExchanges: new Set(),
      allowedBridges: new Set(["across"]), allowedTargets: new Set([routeTarget.toLowerCase()]),
      allowedApprovalTargets: new Set([approvalTarget.toLowerCase()])
    } });
}

describe("LI.FI Across V4 quote preview", () => {
  const input = { fromAssetId: baseUsdc.id, toAssetId: arbitrumUsdc.id,
    amount: "1", fromAddress: wallet, slippageBps: 50 };
  it("accepts a zero destination gas estimate without broadening the executable route", async () => {
    const quote = acrossCompositeQuote();
    (quote.includedSteps[1].action as typeof quote.includedSteps[1]["action"] & {
      destinationGasConsumption?: string
    }).destinationGasConsumption = "0";
    const [result] = await acrossCompositeAdapter(quote).quoteWithPlans(input,
      { from: baseUsdc, to: arbitrumUsdc });
    expect(result.quote).toMatchObject({ provider: "lifi:across", routeKind: "cross_chain" });
    expect(result.plan.routeSteps.map((step) => step.type)).toEqual(["protocol", "cross"]);
  });

  it("rejects a nonzero destination gas estimate", async () => {
    const quote = acrossCompositeQuote();
    (quote.includedSteps[1].action as typeof quote.includedSteps[1]["action"] & {
      destinationGasConsumption?: string
    }).destinationGasConsumption = "1";
    await expect(acrossCompositeAdapter(quote).quoteWithPlans(input,
      { from: baseUsdc, to: arbitrumUsdc })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("retains the exact fee and bridge call privately while previewing a reviewed cross-network route", async () => {
    const [result] = await acrossCompositeAdapter(acrossCompositeQuote()).quoteWithPlans(input,
      { from: baseUsdc, to: arbitrumUsdc });
    expect(result.quote).toMatchObject({ provider: "lifi:across", routeKind: "cross_chain", toAmountMinRaw: "995000" });
    expect(result.quote).not.toHaveProperty("sourceCall");
    expect(result.plan.routeSteps.map((step) => step.type)).toEqual(["protocol", "cross"]);
    expect(result.plan.sourceCall.data).toMatch(/^0x1794958f/);
  });
});

describe("provider-neutral LI.FI quotes", () => {
  it("rejects a composite route when its source calldata is only a selector", async () => {
    const invalid = compositeQuote();
    invalid.transactionRequest.data = "0x5fd9ae2e";
    await expect(compositeAdapter(invalid).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 },
    { from: baseUsdc, to: baseWeth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it.each([
    ["destination token", baseWeth.address!.slice(2).toLowerCase(), "0000000000000000000000000000000000000042"],
    ["fee distribution", "0".repeat(60) + "9c4", "0".repeat(60) + "9c5"]
  ])("rejects a composite route when encoded %s differs from the displayed quote", async (_label, original, replacement) => {
    const invalid = compositeQuote();
    const data = invalid.transactionRequest.data.replace(original, replacement);
    expect(data).not.toBe(invalid.transactionRequest.data);
    invalid.transactionRequest.data = data as `0x${string}`;
    await expect(compositeAdapter(invalid).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 },
    { from: baseUsdc, to: baseWeth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("previews an observed fee-collection plus swap route without exposing execution authority", async () => {
    const result = await compositeAdapter(compositeQuote()).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth });
    expect(result).toHaveLength(1);
    expect(result[0].quote).toMatchObject({ provider: "lifi:nordstern", toAmountMinRaw: "290000000000000", providerFeeUsd: 0.0025 });
    expect(result[0].quote).not.toHaveProperty("transactionRequest");
    expect(result[0].plan.routeSteps.map((step) => [step.type, step.tool])).toEqual([["protocol", "feeCollection"], ["swap", "nordstern"]]);
    expect(result[0].plan.sourceCall).toMatchObject({ to: routeTarget.toLowerCase(), value: "0" });
    expect(result[0].plan.sourceCall.data).toMatch(/^0x5fd9ae2e/);
  });

  it("rejects a composite fee or swap amount discontinuity", async () => {
    const changed = compositeQuote();
    changed.includedSteps[1].action.fromAmount = "997501";
    await expect(compositeAdapter(changed).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a nested route that exceeds the reviewed slippage", async () => {
    const changed = compositeQuote();
    changed.includedSteps[1].action.slippage = 0.2;
    await expect(compositeAdapter(changed).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a provider slippage that cannot be revalidated from the retained plan", async () => {
    const changed = compositeQuote();
    changed.action.slippage = 0.003;
    await expect(compositeAdapter(changed).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects protocol fee steps in a non-composite root quote", async () => {
    const changed = compositeQuote();
    changed.type = "swap";
    changed.includedSteps = [{ ...changed.includedSteps[0], action: { ...changed.includedSteps[0].action,
      fromAddress: wallet, toAddress: wallet } }];
    delete (changed.transactionRequest as { gasLimit?: string }).gasLimit;
    delete (changed.transactionRequest as { gasPrice?: string }).gasPrice;
    await expect(compositeAdapter(changed).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects nested token scales or chains that conflict with the routed action", async () => {
    const changed = compositeQuote();
    changed.includedSteps[0].action.fromToken = { ...changed.includedSteps[0].action.fromToken, decimals: 18 };
    const input = { fromAssetId: baseUsdc.id, toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    await expect(compositeAdapter(changed).quoteWithPlans(input, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
    changed.includedSteps[0].action.fromToken = compositeQuote().includedSteps[0].action.fromToken;
    changed.includedSteps[0].action.toToken = { ...changed.includedSteps[0].action.toToken, chainId: 1 };
    await expect(compositeAdapter(changed).quoteWithPlans(input, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a second fee-collection step matching the same reported fee", async () => {
    const changed = compositeQuote();
    changed.includedSteps.splice(1, 0, structuredClone(changed.includedSteps[0]));
    await expect(compositeAdapter(changed).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a fee share inconsistent with the quoted fee amount", async () => {
    const changed = compositeQuote();
    changed.includedSteps[0].action.integratorFees.feePercent = 0.1;
    await expect(compositeAdapter(changed).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a swap step that reports a different integrator fee from the fee step", async () => {
    const changed = compositeQuote();
    changed.includedSteps[1].action.integratorFees = { feePercent: 0.1 };
    await expect(compositeAdapter(changed).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a concealed executable call inside composite fee metadata", async () => {
    const changed = compositeQuote();
    (changed.includedSteps[0].action.integratorFees as Record<string, unknown>).destinationCall = { to: wallet, data: "0x1234" };
    await expect(compositeAdapter(changed).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects malformed provider gas fields even when the matching field is absent", async () => {
    const changed = compositeQuote();
    delete (changed.transactionRequest as { gasLimit?: string }).gasLimit;
    changed.transactionRequest.gasPrice = "not-a-price";
    await expect(compositeAdapter(changed).quoteWithPlans({ fromAssetId: baseUsdc.id,
      toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseWeth }))
      .rejects.toMatchObject({ code: "no_live_route" });
  });

  it("binds provider gas fields into the private plan fingerprint", async () => {
    const original = compositeQuote();
    const changed = compositeQuote();
    changed.transactionRequest.gasPrice = "0x989681";
    const input = { fromAssetId: baseUsdc.id, toAssetId: baseWeth.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    const [before] = await compositeAdapter(original).quoteWithPlans(input, { from: baseUsdc, to: baseWeth });
    const [after] = await compositeAdapter(changed).quoteWithPlans(input, { from: baseUsdc, to: baseWeth });
    expect(after.plan.fingerprint).not.toBe(before.plan.fingerprint);
    expect(after.plan.sourceCall.providerGasPrice).toBe("10000001");
  });
  it("asks LI.FI to choose only from configured audited exchanges", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      requests.push(String(input));
      return Response.json(lifiQuote());
    };
    await adapterWithFetcher(fetcher).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth });

    expect(new URL(requests[0]).searchParams.getAll("allowExchanges")).toEqual(["0x", "1inch"]);
    expect(new URL(requests[0]).searchParams.getAll("allowBridges")).toEqual(["none"]);
  });

  it("uses only the audited bridge filter for cross-chain quotes", async () => {
    const payload = lifiQuote();
    payload.tool = "across";
    payload.action.toChainId = 1;
    payload.action.toToken.chainId = 1;
    const requests: string[] = [];
    const fetcher: typeof fetch = async (input) => { requests.push(String(input)); return Response.json(payload); };
    await adapterWithFetcher(fetcher).quote({ fromAssetId: baseUsdc.id, toAssetId: mainnetEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: mainnetEth });
    expect(new URL(requests[0]).searchParams.getAll("allowBridges")).toEqual(["across"]);
    expect(new URL(requests[0]).searchParams.getAll("allowExchanges")).toEqual(["0x", "1inch"]);
  });

  it("fails closed for a cross-chain quote when no audited bridge is configured", async () => {
    const fetcher = vi.fn(async () => Response.json(lifiQuote()));
    const configured = createLifiQuoteAdapter({ fetcher, policy: {
      allowedTools: new Set(["across"]), allowedExchanges: new Set(["1inch"]), allowedBridges: new Set(),
      allowedTargets: new Set([routeTarget.toLowerCase()]), allowedApprovalTargets: new Set([approvalTarget.toLowerCase()])
    } });
    await expect(configured.quote({ fromAssetId: baseUsdc.id, toAssetId: mainnetEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: mainnetEth })).rejects.toMatchObject({ code: "no_live_route" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a returned cross-chain tool outside the audited bridge list", async () => {
    const payload = lifiQuote();
    payload.tool = "1inch";
    payload.action.toChainId = 1;
    payload.action.toToken.chainId = 1;
    await expect(adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: mainnetEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: mainnetEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a protocol root route outside the modeled Swap and bridge classes", async () => {
    const payload = { ...lifiQuote(), type: "protocol" };
    await expect(adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a cross-chain response mislabeled as a same-chain swap", async () => {
    const payload = { ...lifiQuote(), type: "swap" };
    payload.tool = "across";
    payload.action.toChainId = 1;
    payload.action.toToken.chainId = 1;
    await expect(adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: mainnetEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: mainnetEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a nested destination call in provider data", async () => {
    const payload = { ...lifiQuote(), action: { ...lifiQuote().action, destinationCall: { to: routeTarget, data: "0x1234" } } };
    await expect(adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a provider source transaction from another wallet", async () => {
    const payload = { ...lifiQuote(), transactionRequest: { ...lifiQuote().transactionRequest, from: "0x4444444444444444444444444444444444444444" } };
    await expect(adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a nested call hidden in the source transaction envelope", async () => {
    const payload = { ...lifiQuote(), transactionRequest: { ...lifiQuote().transactionRequest, destinationCall: { to: routeTarget, data: "0x1234" } } };
    await expect(adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a nested route step using an unaudited tool", async () => {
    const payload = { ...lifiQuote(), includedSteps: [{ id: "nested-1", type: "swap", tool: "unknown", action: { destinationCall: { to: routeTarget, data: "0x1234" } } }] };
    await expect(adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("keeps audited nested step identities in the private plan", async () => {
    const payload = { ...lifiQuote(), includedSteps: [{ id: "nested-1", type: "swap", tool: "1inch" }] };
    const result = await adapter(payload).quoteWithPlans({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth });
    expect(result[0].plan.routeSteps).toEqual([{ id: "nested-1", type: "swap", tool: "1inch" }]);
    expect(result[0].quote).not.toHaveProperty("routeSteps");
  });

  it("rejects a composite LI.FI route with no included steps", async () => {
    await expect(adapter({ ...lifiQuote(), type: "lifi" }).quoteWithPlans(
      { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 },
      { from: baseUsdc, to: baseEth }
    )).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects a composite LI.FI route with an incomplete included step", async () => {
    await expect(adapter({ ...lifiQuote(), type: "lifi", includedSteps: [{ id: "step-1", type: "swap", tool: "1inch" }] }).quoteWithPlans(
      { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 },
      { from: baseUsdc, to: baseEth }
    )).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("retains displayed economics in the private plan fingerprint", async () => {
    const input = { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    const original = lifiQuote();
    const revised = lifiQuote();
    original.estimate = { ...original.estimate, gasCosts: [{ amountUSD: "0.01" }], feeCosts: [{ amountUSD: "0.02" }] } as typeof original.estimate;
    revised.estimate = { ...revised.estimate, gasCosts: [{ amountUSD: "0.03" }], feeCosts: [{ amountUSD: "0.04" }] } as typeof revised.estimate;
    const a = (await adapter(original).quoteWithPlans(input, { from: baseUsdc, to: baseEth }))[0];
    const b = (await adapter(revised).quoteWithPlans(input, { from: baseUsdc, to: baseEth }))[0];
    expect(a.plan.economics).toMatchObject({ fromAmountUsd: "1", toAmountUsd: "0.99", toAmountRaw: "300000000000000", networkFeeUsd: 0.01, providerFeeUsd: 0.02, totalFeeUsd: 0.03, priceImpactPercent: 1, feeCosts: [{ amountUSD: "0.02" }] });
    expect(a.quote.networkFeeUsd).toBe(a.plan.economics.networkFeeUsd);
    expect(a.quote).toMatchObject({ providerFeeUsd: 0.02, totalFeeUsd: 0.03 });
    expect(a.plan.fingerprint).not.toBe(b.plan.fingerprint);
  });

  it("fingerprints LI.FI fee inclusion and amount even when USD totals match", async () => {
    const input = { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    const original = lifiQuote();
    const revised = lifiQuote();
    original.estimate = { ...original.estimate, feeCosts: [{ amountUSD: "0.02", amount: "20", included: true }] } as typeof original.estimate;
    revised.estimate = { ...revised.estimate, feeCosts: [{ amountUSD: "0.02", amount: "21", included: false }] } as typeof revised.estimate;
    const a = (await adapter(original).quoteWithPlans(input, { from: baseUsdc, to: baseEth }))[0];
    const b = (await adapter(revised).quoteWithPlans(input, { from: baseUsdc, to: baseEth }))[0];
    expect(a.plan.fingerprint).not.toBe(b.plan.fingerprint);
  });

  it("treats an explicit empty LI.FI cost list as zero rather than unavailable", async () => {
    const payload = lifiQuote();
    payload.estimate = { ...payload.estimate, gasCosts: [], feeCosts: [] } as typeof payload.estimate;
    const result = await adapter(payload).quoteWithPlans(
      { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 },
      { from: baseUsdc, to: baseEth }
    );
    expect(result[0].plan.economics).toMatchObject({ networkFeeUsd: 0, providerFeeUsd: 0, totalFeeUsd: 0, feeCosts: [] });
  });

  it("marks an overflowing USD cost total unavailable", async () => {
    const payload = lifiQuote();
    payload.estimate = { ...payload.estimate, gasCosts: [{ amountUSD: "1e308" }, { amountUSD: "1e308" }] } as typeof payload.estimate;
    const result = await adapter(payload).quoteWithPlans(
      { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 },
      { from: baseUsdc, to: baseEth }
    );
    expect(result[0].quote.networkFeeUsd).toBeNull();
    expect(result[0].plan.economics.networkFeeUsd).toBeNull();
  });

  it("rejects unretained provider gas overrides", async () => {
    const payload = { ...lifiQuote(), transactionRequest: { ...lifiQuote().transactionRequest, gasLimit: "21000" } };
    await expect(adapter(payload).quoteWithPlans(
      { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 },
      { from: baseUsdc, to: baseEth }
    )).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("accepts LI.FI nested step metadata without treating it as executable authority", async () => {
    const payload = { ...lifiQuote(), includedSteps: [{ id: "nested-1", type: "swap", tool: "1inch",
      toolDetails: { key: "1inch", name: "1inch" }, estimate: { fromAmount: "1000000" } }] };
    const result = await adapter(payload).quoteWithPlans({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth });
    expect(result[0].plan.routeSteps).toEqual([{ id: "nested-1", type: "swap", tool: "1inch" }]);
    expect(JSON.stringify(result[0].plan)).not.toContain("toolDetails");
  });

  it("rejects a nested executable source request", async () => {
    const payload = { ...lifiQuote(), includedSteps: [{ id: "nested-1", type: "swap", tool: "1inch", transactionRequest: { to: routeTarget, data: "0x1234" } }] };
    await expect(adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("changes the plan fingerprint if the minimum or calldata changes", async () => {
    const input = { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    const original = await adapter(lifiQuote()).quoteWithPlans(input, { from: baseUsdc, to: baseEth });
    const minimum = lifiQuote(); minimum.estimate.toAmountMin = "280000000000000";
    const calldata = lifiQuote(); calldata.transactionRequest.data = "0xabcd";
    const changedMinimum = await adapter(minimum).quoteWithPlans(input, { from: baseUsdc, to: baseEth });
    const changedCalldata = await adapter(calldata).quoteWithPlans(input, { from: baseUsdc, to: baseEth });
    expect(changedMinimum[0].plan.fingerprint).not.toBe(original[0].plan.fingerprint);
    expect(changedCalldata[0].plan.fingerprint).not.toBe(original[0].plan.fingerprint);
  });

  it("retains the exact normalized unsigned call only in the internal plan", async () => {
    const input = { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    const result = await adapter(lifiQuote()).quoteWithPlans(input, { from: baseUsdc, to: baseEth });
    expect(result[0].quote).not.toHaveProperty("transactionRequest");
    expect(JSON.stringify(result[0].quote)).not.toContain("0x1234");
    expect(result[0].plan).toMatchObject({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, fromAmountRaw: "1000000",
      toAmountMinRaw: "290000000000000", recipient: wallet, slippageBps: 50,
      quoteId: "quote-1", stepId: "quote-1", toolId: "1inch", approvalSpender: approvalTarget.toLowerCase(),
      sourceCall: { chainId: 8453, from: wallet, to: routeTarget, value: "0", data: "0x1234" }
    });
    expect(result[0].plan.fingerprint).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it("fingerprints equivalent decimal and hex source values identically", async () => {
    const first = lifiQuote();
    const second = lifiQuote(); second.transactionRequest.value = "0x0";
    const input = { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    const a = await adapter(first).quoteWithPlans(input, { from: baseUsdc, to: baseEth });
    const b = await adapter(second).quoteWithPlans(input, { from: baseUsdc, to: baseEth });
    expect(a[0].plan.fingerprint).toBe(b[0].plan.fingerprint);
  });

  it("records policy and catalog changes in the retained plan identity", async () => {
    const input = { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    const original = await adapter(lifiQuote()).quoteWithPlans(input, { from: baseUsdc, to: baseEth });
    const revisedPolicy = createLifiQuoteAdapter({
      fetcher: vi.fn(async () => Response.json(lifiQuote())), now: () => Date.parse("2026-09-22T12:00:00.000Z"),
      policy: { allowedTools: new Set(["1inch", "across"]), allowedExchanges: new Set(["1inch", "0x"]),
        allowedBridges: new Set(["across"]), allowedTargets: new Set([routeTarget.toLowerCase(), "0x4444444444444444444444444444444444444444"]),
        allowedApprovalTargets: new Set([approvalTarget.toLowerCase()]) }
    });
    const changedPolicy = await revisedPolicy.quoteWithPlans(input, { from: baseUsdc, to: baseEth });
    const changedCatalog = await adapter(lifiQuote()).quoteWithPlans({ ...input, unverifiedAcknowledgements: [baseUsdc.id] }, { from: { ...baseUsdc, verification: "unverified" }, to: baseEth });
    expect(changedPolicy[0].plan.routePolicyVersion).not.toBe(original[0].plan.routePolicyVersion);
    expect(changedPolicy[0].plan.fingerprint).not.toBe(original[0].plan.fingerprint);
    expect(changedCatalog[0].plan.catalogVersion).not.toBe(original[0].plan.catalogVersion);
  });

  it("accepts a valid quote response delivered in chunks", async () => {
    const encoded = new TextEncoder().encode(JSON.stringify(lifiQuote()));
    const midpoint = Math.floor(encoded.byteLength / 2);
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.slice(0, midpoint));
        controller.enqueue(encoded.slice(midpoint));
        controller.close();
      }
    }));

    const quotes = await adapterWithFetcher(fetcher).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth });
    expect(quotes).toHaveLength(1);
  });

  it("cancels an oversized chunked quote response before JSON parsing", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(600_000).fill(32);
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel() { cancelled = true; }
    }));

    await expect(adapterWithFetcher(fetcher).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "quote_unavailable" });
    expect(cancelled).toBe(true);
  });

  it("rejects a declared oversized quote response without consuming it", async () => {
    let cancelled = false;
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([123])); },
      cancel() { cancelled = true; }
    }), { headers: { "content-length": "1000001" } });

    await expect(adapterWithFetcher(fetcher).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "quote_unavailable" });
    expect(cancelled).toBe(true);
  });

  it("preserves canonical identities and immutable raw amounts for a same-chain route", async () => {
    const [quote] = await adapter(lifiQuote()).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth });

    expect(quote).toMatchObject({
      provider: "lifi:1inch", quoteId: "quote-1", fromAssetId: baseUsdc.id, toAssetId: baseEth.id,
      fromChainId: 8453, toChainId: 8453, fromAmountRaw: "1000000",
      toAmountRaw: "300000000000000", toAmountMinRaw: "290000000000000",
      networkFeeUsd: null, priceImpactPercent: 1, approvalTarget, routeKind: "same_chain"
    });
    expect(quote.planReference).toMatch(/^lifi:quote-1:0x[a-f0-9]{64}$/);
  });

  it("accepts LI.FI hex transaction values without changing an equivalent plan reference", async () => {
    const decimal = lifiQuote();
    const hexadecimal = lifiQuote();
    hexadecimal.transactionRequest.value = "0x0";
    const input = { fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    const [decimalQuote] = await adapter(decimal).quote(input, { from: baseUsdc, to: baseEth });
    const [hexQuote] = await adapter(hexadecimal).quote(input, { from: baseUsdc, to: baseEth });
    expect(hexQuote.planReference).toBe(decimalQuote.planReference);
  });

  it("accepts an exact hex native source value and rejects malformed or excessive values", async () => {
    const nativeQuote = lifiQuote();
    nativeQuote.action.fromToken = { symbol: "ETH", decimals: 18, chainId: 8453, address: "0x0000000000000000000000000000000000000000" };
    nativeQuote.action.toToken = { symbol: "USDC", decimals: 6, chainId: 8453, address: baseUsdc.address! };
    nativeQuote.action.fromAmount = "1000000000000000000";
    nativeQuote.estimate.fromAmount = "1000000000000000000";
    nativeQuote.estimate.toAmount = "990000";
    nativeQuote.estimate.toAmountMin = "980000";
    delete (nativeQuote.estimate as Partial<typeof nativeQuote.estimate>).approvalAddress;
    nativeQuote.transactionRequest.value = "0xde0b6b3a7640000";
    const input = { fromAssetId: baseEth.id, toAssetId: baseUsdc.id, amount: "1", fromAddress: wallet, slippageBps: 50 };
    await expect(adapter(nativeQuote).quote(input, { from: baseEth, to: baseUsdc })).resolves.toHaveLength(1);

    for (const value of ["0x", "0xgg", "-1", `0x1${"0".repeat(64)}`, "0xde0b6b3a7640001"]) {
      const invalid = structuredClone(nativeQuote);
      invalid.transactionRequest.value = value;
      await expect(adapter(invalid).quote(input, { from: baseEth, to: baseUsdc })).rejects.toMatchObject({ code: "no_live_route" });
    }
  });

  it("enforces the uint256 boundary even when a native quote and request agree", async () => {
    const max = (1n << 256n) - 1n;
    for (const [rawAmount, accepted] of [[max, true], [max + 1n, false]] as const) {
      const quote = lifiQuote();
      quote.action.fromToken = { symbol: "ETH", decimals: 18, chainId: 8453, address: "0x0000000000000000000000000000000000000000" };
      quote.action.toToken = { symbol: "USDC", decimals: 6, chainId: 8453, address: baseUsdc.address! };
      quote.action.fromAmount = rawAmount.toString();
      quote.estimate.fromAmount = rawAmount.toString();
      quote.estimate.toAmount = "990000";
      quote.estimate.toAmountMin = "980000";
      delete (quote.estimate as Partial<typeof quote.estimate>).approvalAddress;
      quote.transactionRequest.value = `0x${rawAmount.toString(16)}`;
      const result = adapter(quote).quote({ fromAssetId: baseEth.id, toAssetId: baseUsdc.id, amount: formatUnits(rawAmount, 18), fromAddress: wallet, slippageBps: 50 }, { from: baseEth, to: baseUsdc });
      if (accepted) await expect(result).resolves.toHaveLength(1);
      else await expect(result).rejects.toMatchObject({ code: "no_live_route" });
    }
  });

  it("uses the source asset's actual decimals and rejects excessive request precision", async () => {
    await expect(adapter(lifiQuote()).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1.0000001", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "asset_unavailable" });
  });

  it("accepts a validated cross-chain route without exposing an executable request", async () => {
    const payload = lifiQuote();
    payload.tool = "across";
    payload.action.toChainId = 1;
    payload.action.toToken.chainId = 1;
    const [quote] = await adapter(payload).quote({
      fromAssetId: baseUsdc.id, toAssetId: mainnetEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: mainnetEth });
    expect(quote.routeKind).toBe("cross_chain");
    expect(quote).not.toHaveProperty("transactionRequest");
  });

  it.each([
    ["source identity", (quote: ProviderQuote) => { quote.action.fromToken.address = "0x4444444444444444444444444444444444444444"; }],
    ["input amount", (quote: ProviderQuote) => { quote.estimate.fromAmount = "2000000"; }],
    ["action input amount", (quote: ProviderQuote) => { quote.action.fromAmount = "2000000"; }],
    ["source wallet", (quote: ProviderQuote) => { quote.action.fromAddress = "0x4444444444444444444444444444444444444444"; }],
    ["destination wallet", (quote: ProviderQuote) => { quote.action.toAddress = "0x4444444444444444444444444444444444444444"; }],
    ["slippage", (quote: ProviderQuote) => { quote.action.slippage = 0.05; }],
    ["source transaction chain", (quote: ProviderQuote) => { quote.transactionRequest.chainId = 1; }],
    ["output", (quote: ProviderQuote) => { quote.estimate.toAmount = "0"; }],
    ["minimum", (quote: ProviderQuote) => { quote.estimate.toAmountMin = "400000000000000"; }],
    ["target", (quote: ProviderQuote) => { quote.transactionRequest.to = "0x4444444444444444444444444444444444444444"; }],
    ["spender", (quote: ProviderQuote) => { quote.estimate.approvalAddress = "0x4444444444444444444444444444444444444444"; }],
    ["value", (quote: ProviderQuote) => { quote.transactionRequest.value = "1"; }],
    ["calldata", (quote: ProviderQuote) => { quote.transactionRequest.data = "0x"; }],
    ["tool", (quote: ProviderQuote) => { quote.tool = "unknown"; }]
  ])("fails closed when LI.FI changes the %s", async (_label, mutate) => {
    const payload = lifiQuote(); mutate(payload);
    await expect(adapter(payload).quote({
      fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50
    }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("rejects stale and excessive-price-impact routes", async () => {
    const stale = lifiQuote(); stale.expiresAt = "2026-09-22T11:59:59.000Z";
    await expect(adapter(stale).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
    const impact = lifiQuote(); impact.estimate.toAmountUSD = "0.90";
    await expect(adapter(impact).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("withholds an unverified route when price impact is unavailable", async () => {
    const unverified = { ...baseUsdc, verification: "unverified" as const };
    const payload = lifiQuote();
    delete (payload.estimate as Partial<typeof payload.estimate>).fromAmountUSD;
    delete (payload.estimate as Partial<typeof payload.estimate>).toAmountUSD;
    await expect(adapter(payload).quote({ fromAssetId: unverified.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50, unverifiedAcknowledgements: [unverified.id] }, { from: unverified, to: baseEth })).rejects.toMatchObject({ code: "no_live_route" });
  });

  it("labels missing fee and price observations unavailable for verified assets", async () => {
    const payload = lifiQuote();
    delete (payload.estimate as Partial<typeof payload.estimate>).fromAmountUSD;
    delete (payload.estimate as Partial<typeof payload.estimate>).toAmountUSD;
    const [quote] = await adapter(payload).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth });
    expect(quote).toMatchObject({ networkFeeUsd: null, priceImpactPercent: null });
  });

  it("returns a typed unsupported-chain error at the adapter boundary", async () => {
    const unsupported = { ...baseEth, id: "56:native", chainId: 56 };
    await expect(adapter(lifiQuote()).quote({ fromAssetId: baseUsdc.id, toAssetId: unsupported.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: unsupported })).rejects.toMatchObject({ code: "unsupported_chain" });
  });

  it("binds the immutable plan reference to the owned source wallet", async () => {
    const first = await adapter(lifiQuote()).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: wallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth });
    const otherWallet = "0x5555555555555555555555555555555555555555";
    const otherQuote = lifiQuote();
    otherQuote.action.fromAddress = otherWallet;
    otherQuote.action.toAddress = otherWallet;
    const second = await adapter(otherQuote).quote({ fromAssetId: baseUsdc.id, toAssetId: baseEth.id, amount: "1", fromAddress: otherWallet, slippageBps: 50 }, { from: baseUsdc, to: baseEth });
    expect(first[0].planReference).not.toBe(second[0].planReference);
  });
});
