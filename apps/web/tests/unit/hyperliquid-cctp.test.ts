import { decodeFunctionData, parseAbi } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  BASE_TOKEN_MESSENGER_V2, BASE_USDC, cctpDepositCalls, cctpDepositFee, cctpDepositProgress, findCctpCredit, hyperCoreHookData,
  verifyCctpDeposit
} from "@/lib/markets/hyperliquid/cctp";
import type { LedgerTransfer } from "@/lib/markets/hyperliquid/info";
import { VenueError } from "@/lib/markets/types";

const owner = "0xA275CA4937A755E7070F486FB3ADE4CFB01111FB";
const forwarder = "0xb21d281dedb17ae5b501f6aa8256fe38c4e45757";
const sourceTx = `0x${"ab".repeat(32)}`;
const abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function depositForBurnWithHook(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold, bytes hookData)"
]);

function fetcherFor(payload: unknown, init?: ResponseInit) {
  return vi.fn(async (input: RequestInfo | URL, request?: RequestInit) => {
    void input; void request;
    return Response.json(payload, init);
  });
}

describe("CCTP deposit from Base to HyperCore", () => {
  it("encodes the forwarder hook data byte for byte like a real Base → HyperCore message", () => {
    // From Circle's decoded message for a live Base deposit (spot destination, dex = uint32 max).
    expect(hyperCoreHookData(owner, 0xffff_ffff)).toBe(
      "0x636374702d666f72776172640000000000000000000000000000000000000018a275ca4937a755e7070f486fb3ade4cfb01111fbffffffff");
    expect(hyperCoreHookData(owner).endsWith("a275ca4937a755e7070f486fb3ade4cfb01111fb00000000")).toBe(true);
    expect(() => hyperCoreHookData("0x12")).toThrow(VenueError);
  });

  it("builds approve + depositForBurnWithHook on Base to the forwarder, fast, crediting the owner's perp balance", () => {
    const [approve, burn] = cctpDepositCalls({ owner, amountRaw: "25000000", maxFeeRaw: "265217" });
    expect(approve).toMatchObject({ to: BASE_USDC, value: "0" });
    expect(decodeFunctionData({ abi, data: approve.data }).args).toEqual([expect.stringMatching(/^0x28b5a0e9/i), 25_000_000n]);
    expect(burn).toMatchObject({ to: BASE_TOKEN_MESSENGER_V2, value: "0" });
    const decoded = decodeFunctionData({ abi, data: burn.data });
    expect(decoded.functionName).toBe("depositForBurnWithHook");
    const [amount, domain, mintRecipient, burnToken, caller, maxFee, finality, hook] = decoded.args as readonly unknown[];
    expect([amount, domain, maxFee, finality]).toEqual([25_000_000n, 19, 265_217n, 1000]);
    expect(mintRecipient).toBe(`0x${"0".repeat(24)}${forwarder.slice(2)}`);
    expect(caller).toBe(mintRecipient);
    expect(String(burnToken).toLowerCase()).toBe(BASE_USDC);
    expect(hook).toBe(hyperCoreHookData(owner, 0));
  });

  it("refuses amounts that don't cover the fee", () => {
    expect(() => cctpDepositCalls({ owner, amountRaw: "100", maxFeeRaw: "100" })).toThrow(VenueError);
    expect(() => cctpDepositCalls({ owner, amountRaw: "1.5", maxFeeRaw: "1" })).toThrow(VenueError);
  });

  it("prices the fee from Circle's quote: protocol bps rounded up + 20%, plus the high forwarding fee", async () => {
    const fetcher = fetcherFor([
      { finalityThreshold: 1000, minimumFee: 1.3, forwardFee: { low: 232652, med: 246949, high: 261247 } },
      { finalityThreshold: 2000, minimumFee: 0, forwardFee: { low: 232652, med: 246949, high: 261247 } }
    ]);
    await expect(cctpDepositFee("25000000", { fetcher })).resolves.toEqual({
      protocolFeeRaw: "3250", forwardFeeRaw: "246949", maxFeeRaw: "265147", minimumCreditRaw: "24734853" });
    expect(fetcher.mock.calls[0][0]).toBe("https://iris-api.circle.com/v2/burn/USDC/fees/6/19?forward=true&hyperCoreDeposit=true");
    await expect(cctpDepositFee("200000", { fetcher })).rejects.toThrow(/too small/);
    await expect(cctpDepositFee("25000000", { fetcher: fetcherFor([{ finalityThreshold: 2000, minimumFee: 0 }]) }))
      .rejects.toMatchObject({ code: "invalid_response" });
  });
});

function message(overrides: { hookData?: string; status?: string; forwardState?: string; feeExecuted?: string | null } = {}) {
  return { messages: [{
    status: overrides.status ?? "complete", forwardState: overrides.forwardState ?? "COMPLETE",
    forwardTxHash: `0x${"f9".repeat(32)}`,
    decodedMessage: { sourceDomain: "6", destinationDomain: "19", destinationCaller: forwarder,
      decodedMessageBody: { burnToken: BASE_USDC, mintRecipient: forwarder, amount: "25000000",
        feeExecuted: overrides.feeExecuted === undefined ? "250199" : overrides.feeExecuted,
        hookData: overrides.hookData ?? hyperCoreHookData(owner) } }
  }] };
}

describe("verifying a CCTP deposit", () => {
  it("follows the Base burn through Circle to the forwarded amount", async () => {
    const fetcher = fetcherFor(message());
    await expect(cctpDepositProgress(sourceTx, owner, { fetcher })).resolves.toEqual({ state: "forwarded", amountRaw: "25000000",
      feeRaw: "250199", creditedRaw: "24749801", forwardTxHash: `0x${"f9".repeat(32)}` });
    expect(fetcher.mock.calls[0][0]).toBe(`https://iris-api.circle.com/v2/messages/6?transactionHash=${sourceTx}`);
  });

  it("reports pending, failed, not found, and a message for someone else", async () => {
    await expect(cctpDepositProgress(sourceTx, owner, { fetcher: fetcherFor(message({ status: "pending_confirmations", forwardState: "PENDING" })) }))
      .resolves.toMatchObject({ state: "pending" });
    await expect(cctpDepositProgress(sourceTx, owner, { fetcher: fetcherFor(message({ forwardState: "FAILED" })) }))
      .resolves.toEqual({ state: "failed", forwardState: "FAILED" });
    await expect(cctpDepositProgress(sourceTx, owner, { fetcher: fetcherFor({ error: "Message not found" }, { status: 404 }) }))
      .resolves.toEqual({ state: "not_found" });
    await expect(cctpDepositProgress(sourceTx, owner, { fetcher: fetcherFor(message({ hookData: hyperCoreHookData(owner, 0xffff_ffff) })) }))
      .resolves.toEqual({ state: "mismatch" });
    await expect(cctpDepositProgress("0x12", owner, { fetcher: fetcherFor({}) })).rejects.toMatchObject({ code: "invalid_request" });
  });

  const credit = (usdc: string, time: number, hash = `0x${"c3".repeat(32)}`): LedgerTransfer =>
    ({ kind: "deposit", route: "cctp", usdc, fee: "0", dex: "", hash, time });

  it("matches the HyperCore credit by exact amount, perp balance, and time", () => {
    const transfers = [credit("24.749801", 900), credit("24.749801", 1_100, `0x${"d4".repeat(32)}`), credit("24.7498", 1_050),
      { ...credit("24.749801", 1_200), dex: "xyz" }, { ...credit("24.749801", 1_000, `0x${"e5".repeat(32)}`), route: "bridge" as const }];
    expect(findCctpCredit(transfers, { creditedRaw: "24749801", since: 1_000 })?.hash).toBe(`0x${"d4".repeat(32)}`);
    expect(findCctpCredit(transfers, { creditedRaw: "24749801", since: 1_000, exclude: new Set([`0x${"d4".repeat(32)}`]) })).toBeNull();
  });

  it("calls a deposit credited only when Circle forwarded it and the ledger shows it", async () => {
    const ledger = [{ time: 1_791_019_283_344, hash: `0x${"c3".repeat(32)}`, delta: { type: "send",
      user: "0x6b9e773128f453f5c2c60935ee2de2cbc5390a24", destination: owner.toLowerCase(), sourceDex: "spot", destinationDex: "",
      token: "USDC", amount: "24.749801", usdcValue: "24.749801", fee: "0.0", nativeTokenFee: "0.0", nonce: 1, feeToken: "" } }];
    const fetcher = vi.fn(async (input: RequestInfo | URL) =>
      Response.json(String(input).includes("iris-api") ? message() : ledger));
    await expect(verifyCctpDeposit({ owner, sourceTxHash: sourceTx, since: 1_791_019_000_000 }, { fetcher })).resolves.toMatchObject({
      state: "credited", amountRaw: "25000000", feeRaw: "250199", credit: { usdc: "24.749801", hash: `0x${"c3".repeat(32)}` } });
    const empty = vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).includes("iris-api") ? message() : []));
    await expect(verifyCctpDeposit({ owner, sourceTxHash: sourceTx, since: 0 }, { fetcher: empty }))
      .resolves.toEqual({ state: "forwarding", creditedRaw: "24749801", forwardTxHash: `0x${"f9".repeat(32)}` });
  });
});
