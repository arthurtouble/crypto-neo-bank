import { env } from "cloudflare:workers";
import { createPublicClient, erc20Abi, getAddress, isAddress, parseUnits, http } from "viem";
import { mainnet } from "viem/chains";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { requireFeature } from "@/lib/features/flags";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { route } from "@/lib/http/route";
import { buildSkyCall, skyActionsAbi, skyConversionLimit, skyVaultAbi, SKY_SUSDS, SKY_USDC,
  SKY_USDC_ACTIONS, SKY_USDS, SKY_PSM } from "@/lib/defi/sky-call-policy";

const schema = z.strictObject({
  action: z.enum(["deposit", "withdraw"]), sender: z.string().refine(isAddress),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/).max(40)
});
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers });

/** Privy signs these exact Ethereum calls; Spark and the chain decide the result. */
export const POST = route("defi.sky.action", { unavailable: "action_unavailable", invalid: "invalid_action" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await requireFeature(env.PROJECTION_DB, "defi_actions");
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "sky_action", subject: subject.subjectReference, limit: 20, windowSeconds: 60 });
  const input = schema.parse(await request.json());
  const wallet = await requireLinkedEvmWallet(subject.subjectReference, input.sender);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const profile = await env.PROJECTION_DB.prepare("SELECT account_locked FROM security_profiles WHERE subject_reference = ?")
    .bind(subject.subjectReference).first<{ account_locked: number }>();
  if (!profile || profile.account_locked) return reply({ error: "account_locked", traceId }, 403);
  if ((input.amount.split(".")[1]?.length ?? 0) > 6) return reply({ error: "invalid_amount", traceId }, 400);
  const amountRaw = parseUnits(input.amount, 6);
  if (amountRaw <= 0n) return reply({ error: "invalid_amount", traceId }, 400);
  const identity = { wallet: getAddress(wallet), amountRaw };
  const client = createPublicClient({ chain: mainnet, transport: http("https://ethereum-rpc.publicnode.com", { timeout: 12_000, retryCount: 0 }) });
  const [chainId, gem, dai, savingsToken, psm, usdcBalance, shares] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: SKY_USDC_ACTIONS, abi: skyActionsAbi, functionName: "gem" }),
    client.readContract({ address: SKY_USDC_ACTIONS, abi: skyActionsAbi, functionName: "dai" }),
    client.readContract({ address: SKY_USDC_ACTIONS, abi: skyActionsAbi, functionName: "savingsToken" }),
    client.readContract({ address: SKY_USDC_ACTIONS, abi: skyActionsAbi, functionName: "psm" }),
    client.readContract({ address: SKY_USDC, abi: erc20Abi, functionName: "balanceOf", args: [identity.wallet] }),
    client.readContract({ address: SKY_SUSDS, abi: skyVaultAbi, functionName: "balanceOf", args: [identity.wallet] })
  ]);
  if (chainId !== 1 || getAddress(gem) !== getAddress(SKY_USDC) || getAddress(dai) !== getAddress(SKY_USDS)
    || getAddress(savingsToken) !== getAddress(SKY_SUSDS) || getAddress(psm) !== getAddress(SKY_PSM))
    return reply({ error: "contract_changed", traceId }, 503);
  if (input.action === "deposit" && usdcBalance < amountRaw) return reply({ error: "insufficient_usdc", traceId }, 400);
  const limit = skyConversionLimit(input.action, amountRaw);
  const approvalShares = input.action === "deposit" ? amountRaw
    : await client.readContract({ address: SKY_SUSDS, abi: skyVaultAbi, functionName: "previewWithdraw", args: [limit] });
  if (input.action === "withdraw" && (shares === 0n || approvalShares > shares))
    return reply({ error: "insufficient_susds", traceId }, 400);
  return reply({ action: input.action, amount: input.amount, amountRaw: amountRaw.toString(), chainId: 1,
    conversionLimitRaw: limit.toString(),
    approvalCall: buildSkyCall({ action: input.action, ...identity, approvalShares }),
    vaultCall: buildSkyCall({ action: input.action, ...identity }), executionAvailable: true, traceId }, 200);
});
