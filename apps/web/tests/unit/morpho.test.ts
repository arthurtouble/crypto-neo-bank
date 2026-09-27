import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, parseAbi, parseAbiItem, type PublicClient } from "viem";
import { buildEarn, earnInputSchema } from "@/lib/actions/earn";
import { effectPresent } from "@/lib/actions/verify";
import { MORPHO_USDC, MORPHO_VAULTS, morphoVaultRates, vaultAbi } from "@/lib/defi/morpho";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const steakhouse = MORPHO_VAULTS[0];
const gauntlet = MORPHO_VAULTS[1];

/** A Base node answering the vault's reads: USDC asset, no gates, 100 shares worth 105 USDC. */
function chain(overrides: Partial<Record<string, unknown>> = {}): PublicClient {
  const answers: Record<string, unknown> = { asset: MORPHO_USDC, receiveSharesGate: `0x${"0".repeat(40)}`, sendSharesGate: `0x${"0".repeat(40)}`,
    receiveAssetsGate: `0x${"0".repeat(40)}`, sendAssetsGate: `0x${"0".repeat(40)}`, shares: 100n * 10n ** 18n, usdc: 50_000_000n, ...overrides };
  return { readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: readonly bigint[] }) => {
    if (functionName === "balanceOf") return address.toLowerCase() === MORPHO_USDC ? answers.usdc : answers.shares;
    if (functionName === "convertToAssets") return args![0] * 105n / 100n / 10n ** 12n;
    if (functionName === "previewWithdraw") return args![0] * 10n ** 12n * 100n / 105n + 1n;
    return answers[functionName];
  } } as unknown as PublicClient;
}

const input = (direction: "deposit" | "withdraw", amount: string, vault = steakhouse.id) => earnInputSchema.parse({ kind: "earn", protocol: "morpho", direction, vault, amount });

describe("building a Morpho vault action", () => {
  it("deposits with an exact approval and ERC-4626 deposit, for the account itself", async () => {
    const built = await buildEarn(input("deposit", "12.5"), wallet, chain());
    expect(built.calls.map((call) => call.to)).toEqual([MORPHO_USDC, steakhouse.address]);
    expect(decodeFunctionData({ abi: erc20Abi, data: built.calls[0].data }).args).toEqual([expect.stringMatching(/^0xbeef0e08/i), 12_500_000n]);
    expect(decodeFunctionData({ abi: vaultAbi, data: built.calls[1].data })).toMatchObject({ functionName: "deposit", args: [12_500_000n, expect.stringMatching(/^0x1111/i)] });
    expect(built).toMatchObject({ kind: "earn", chainId: 8453, countsTowardLimit: false,
      effects: [{ type: "morpho_deposit", vault: steakhouse.address, assetsRaw: "12500000" }], summary: { protocol: "morpho", vaultName: "Steakhouse Prime USDC" } });
  });

  it("withdraws an exact amount, or redeems every share so nothing is left behind", async () => {
    const exact = await buildEarn(input("withdraw", "10", gauntlet.id), wallet, chain());
    expect(decodeFunctionData({ abi: vaultAbi, data: exact.calls[0].data })).toMatchObject({ functionName: "withdraw", args: [10_000_000n, expect.any(String), expect.any(String)] });
    expect(exact.effects).toEqual([{ type: "morpho_withdraw", vault: gauntlet.address, assetsRaw: "10000000" }]);
    const all = await buildEarn(input("withdraw", "all", gauntlet.id), wallet, chain());
    expect(decodeFunctionData({ abi: vaultAbi, data: all.calls[0].data })).toMatchObject({ functionName: "redeem", args: [100n * 10n ** 18n, expect.any(String), expect.any(String)] });
    expect(all).toMatchObject({ effects: [{ type: "morpho_redeem", sharesRaw: String(100n * 10n ** 18n) }], summary: { amount: "all", amountRaw: "105000000" } });
  });

  it("refuses a changed vault, a gated V2 vault, and amounts the account doesn't have", async () => {
    await expect(buildEarn(input("deposit", "1"), wallet, chain({ asset: "0x2222222222222222222222222222222222222222" }))).rejects.toMatchObject({ code: "contract_changed" });
    await expect(buildEarn(input("deposit", "1"), wallet, chain({ receiveSharesGate: "0x3333333333333333333333333333333333333333" }))).rejects.toMatchObject({ code: "contract_changed" });
    await expect(buildEarn(input("deposit", "60"), wallet, chain())).rejects.toMatchObject({ code: "insufficient_balance", message: "You don't have enough USDC." });
    await expect(buildEarn(input("withdraw", "200"), wallet, chain())).rejects.toMatchObject({ code: "insufficient_balance" });
    await expect(buildEarn(input("withdraw", "all"), wallet, chain({ shares: 0n }))).rejects.toMatchObject({ message: "You have nothing in Steakhouse Prime USDC." });
    await expect(buildEarn(input("deposit", "all"), wallet, chain())).rejects.toMatchObject({ code: "invalid_amount" });
    expect(() => earnInputSchema.parse({ kind: "earn", protocol: "morpho", direction: "deposit", vault: "some-other-vault", amount: "1" })).toThrow();
  });
});

describe("verifying a Morpho vault action from its logs", () => {
  const events = parseAbi(["event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
    "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)"]);
  const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
  const deposit = (sender: `0x${string}`, assets: bigint) => ({ address: steakhouse.address, topics: encodeEventTopics({ abi: events, eventName: "Deposit", args: { sender, owner: wallet } }) as string[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [assets, 10n ** 18n]) });
  const paid = (value: bigint) => ({ address: MORPHO_USDC, topics: encodeEventTopics({ abi: [transfer], eventName: "Transfer", args: { from: wallet, to: steakhouse.address } }) as string[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]) });
  const withdraw = (receiver: `0x${string}`, assets: bigint, shares: bigint) => ({ address: steakhouse.address,
    topics: encodeEventTopics({ abi: events, eventName: "Withdraw", args: { sender: wallet, receiver, owner: wallet } }) as string[],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [assets, shares]) });

  it("needs the vault's Deposit event from and for the account, and the exact USDC paid in", () => {
    const effect = { type: "morpho_deposit", vault: steakhouse.address, assetsRaw: "12500000" } as const;
    expect(effectPresent(effect, wallet, [paid(12_500_000n), deposit(wallet, 12_500_000n)])).toBe(true);
    expect(effectPresent(effect, wallet, [paid(12_500_000n), deposit(wallet, 12_000_000n)])).toBe(false);
    expect(effectPresent(effect, wallet, [deposit(wallet, 12_500_000n)])).toBe(false);
    expect(effectPresent(effect, wallet, [paid(12_500_000n), deposit("0x9999999999999999999999999999999999999999", 12_500_000n)])).toBe(false);
  });

  it("needs the vault's Withdraw event paying the account: the exact amount, or every share", () => {
    expect(effectPresent({ type: "morpho_withdraw", vault: steakhouse.address, assetsRaw: "10000000" }, wallet, [withdraw(wallet, 10_000_000n, 9n)])).toBe(true);
    expect(effectPresent({ type: "morpho_withdraw", vault: steakhouse.address, assetsRaw: "10000000" }, wallet,
      [withdraw("0x9999999999999999999999999999999999999999", 10_000_000n, 9n)])).toBe(false);
    expect(effectPresent({ type: "morpho_redeem", vault: steakhouse.address, sharesRaw: "500" }, wallet, [withdraw(wallet, 7n, 500n)])).toBe(true);
    expect(effectPresent({ type: "morpho_redeem", vault: steakhouse.address, sharesRaw: "500" }, wallet, [withdraw(wallet, 7n, 499n)])).toBe(false);
  });
});

describe("Morpho vault rates", () => {
  const api = (body: unknown, ok = true) => (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 503 })) as unknown as typeof fetch;

  it("reads each vault's net APY, deposits, and withdrawable liquidity, V1 and V2 alike", async () => {
    const rates = await morphoVaultRates(api({ data: {
      steakhouse_prime_usdc: { netApy: 0.044027, totalAssetsUsd: 444_000_000, liquidityUsd: 163_000_000 },
      gauntlet_usdc_prime: { state: { netApy: 0.044055, totalAssetsUsd: 415_000_000 }, liquidity: { usd: 175_000_000 } } } }), new Date("2026-09-27T12:00:00Z"));
    expect(rates).toEqual({ rates: [
      { vaultId: "steakhouse-prime-usdc", netApyPct: 4.4, totalAssetsUsd: 444_000_000, liquidityUsd: 163_000_000 },
      { vaultId: "gauntlet-usdc-prime", netApyPct: 4.41, totalAssetsUsd: 415_000_000, liquidityUsd: 175_000_000 }
    ], observedAt: "2026-09-27T12:00:00.000Z", source: "Morpho API" });
  });

  it("is unavailable, not guessed, when Morpho fails or returns something incomplete", async () => {
    expect(await morphoVaultRates(api({}, false))).toBeNull();
    expect(await morphoVaultRates(api({ data: { steakhouse_prime_usdc: { netApy: 0.04, totalAssetsUsd: 1, liquidityUsd: 1 }, gauntlet_usdc_prime: null } }))).toBeNull();
    expect(await morphoVaultRates((async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBeNull();
  });
});
