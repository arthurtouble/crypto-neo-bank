import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, type PublicClient } from "viem";
import type { ServerHeldLifiPlan } from "./lifi";
import { parseAssetId } from "./assets";
import { CATALOG_REGISTRY } from "./catalog-registry";

type ApprovalPlan = Pick<ServerHeldLifiPlan,
  "fromAssetId" | "fromChainId" | "fromAmountRaw" | "approvalSpender"> & {
  sourceCall: Pick<ServerHeldLifiPlan["sourceCall"], "chainId" | "from">;
};

type Request = {
  /** A plan loaded by the server, never reconstructed from browser input. */
  plan: ApprovalPlan;
  wallet: string;
  /** The independently reviewed spender for this route, not a browser-supplied value. */
  reviewedSpender: string;
  nowMs: number;
  maxAgeMs: number;
};

type ApprovalStep = {
  chainId: number;
  from: `0x${string}`;
  to: `0x${string}`;
  value: "0";
  data: `0x${string}`;
  spender: `0x${string}`;
  amountRaw: string;
};

type Evidence = { allowanceRaw: string; blockNumber: bigint; blockHash: `0x${string}`; observedAtMs: number };

/** One simulated prerequisite at a time. It does not authorize wallet signing. */
export async function observeNextSwapApproval(client: PublicClient, request: Request): Promise<
  | (Evidence & { kind: "sufficient" })
  | (Evidence & { kind: "approve"; step: ApprovalStep })
  | (Evidence & { kind: "reset_required"; step: ApprovalStep; next: "recheck_after_reset" })
> {
  const { plan } = request;
  const asset = parseAssetId(plan.fromAssetId);
  if (!asset || !asset.address || !CATALOG_REGISTRY.verified.has(plan.fromAssetId)
    || asset.chainId !== plan.fromChainId || plan.sourceCall.chainId !== plan.fromChainId
    || !/^[1-9]\d*$/.test(plan.fromAmountRaw)
    || BigInt(plan.fromAmountRaw) > (1n << 256n) - 1n
    || !plan.approvalSpender || !Number.isSafeInteger(request.nowMs)
    || !Number.isSafeInteger(request.maxAgeMs) || request.maxAgeMs <= 0)
    throw new Error("Invalid reviewed Swap approval plan.");

  const owner = getAddress(request.wallet);
  const spender = getAddress(plan.approvalSpender);
  if (owner !== getAddress(plan.sourceCall.from)
    || spender !== getAddress(request.reviewedSpender)
    || spender === "0x0000000000000000000000000000000000000000")
    throw new Error("Swap approval identity does not match review.");
  if (await client.getChainId() !== asset.chainId) throw new Error("Source RPC chain mismatch.");

  const token = getAddress(asset.address);
  const block = await client.getBlock({ blockTag: "latest" });
  if (block.number === null || !block.hash || !/^0x[0-9a-f]{64}$/i.test(block.hash)
    || block.hash === `0x${"0".repeat(64)}`) throw new Error("Source block unavailable.");
  const observedAtMs = Number(block.timestamp) * 1_000;
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs > request.nowMs
    || request.nowMs - observedAtMs > request.maxAgeMs) throw new Error("Approval block is stale.");

  const allowanceResult = await client.call({ to: token,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
    blockHash: block.hash, requireCanonical: true });
  const allowance = decodeFunctionResult({ abi: erc20Abi, functionName: "allowance",
    data: allowanceResult.data ?? "0x" });
  const evidence = { allowanceRaw: allowance.toString(), blockNumber: block.number,
    blockHash: block.hash, observedAtMs };
  const amount = BigInt(plan.fromAmountRaw);
  if (allowance >= amount) {
    await assertCanonical(client, block.number, block.hash, block.timestamp);
    return { kind: "sufficient", ...evidence };
  }

  // Nonzero insufficient allowances are reset first. A second, exact approval
  // is prepared only after the reset is mined and the allowance is re-read.
  const nextAmount = allowance === 0n ? amount : 0n;
  const step: ApprovalStep = { chainId: asset.chainId, from: owner, to: token,
    value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, nextAmount] }),
    spender, amountRaw: nextAmount.toString() };
  const simulated = await client.call({ account: owner, to: token, value: 0n,
    data: step.data, blockHash: block.hash, requireCanonical: true });
  if (decodeFunctionResult({ abi: erc20Abi, functionName: "approve", data: simulated.data ?? "0x" }) !== true)
    throw new Error("Approval simulation failed.");
  await assertCanonical(client, block.number, block.hash, block.timestamp);
  return allowance === 0n
    ? { kind: "approve", step, ...evidence }
    : { kind: "reset_required", step, next: "recheck_after_reset", ...evidence };
}

async function assertCanonical(client: PublicClient, blockNumber: bigint, hash: `0x${string}`, timestamp: bigint) {
  const canonical = await client.getBlock({ blockNumber });
  if (canonical.hash?.toLowerCase() !== hash.toLowerCase() || canonical.timestamp !== timestamp)
    throw new Error("Canonical approval block changed.");
}
