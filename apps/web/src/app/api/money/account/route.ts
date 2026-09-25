import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { requireActionWallet } from "@/lib/auth/wallet";
import { bridgeClient, getUsdAccount, openUsdAccount, readOnboarding } from "@/lib/providers/bridge";
import { linkStatus } from "@aurel/provider-projections";
import { previewMoneyAccount } from "@/lib/providers/service-catalog";

type Link = { external_customer_id: string | null; onboarding_reference: string | null; status: string; kyc_status: string | null; onboarding_url: string | null };

/** Webhooks are the usual path, but a read can pick up a customer Bridge has created since. */
async function refresh(bridge: NonNullable<Awaited<ReturnType<typeof bridgeClient>>>, subject: string, link: Link): Promise<Link> {
  const onboarding = await readOnboarding(bridge, link.onboarding_reference!).catch(() => null);
  if (!onboarding) return link;
  const status = onboarding.kycStatus === "rejected" ? "rejected" : onboarding.customerId && onboarding.kycStatus === "approved" ? linkStatus("approved") : link.status;
  await env.PROJECTION_DB.prepare(`UPDATE provider_customer_links SET external_customer_id = COALESCE(external_customer_id, ?), status = ?,
      kyc_status = ?, tos_status = ?, updated_at = ? WHERE subject_reference = ? AND provider = 'bridge'`)
    .bind(onboarding.customerId, status, onboarding.kycStatus, onboarding.tosStatus, new Date().toISOString(), subject).run();
  return { ...link, external_customer_id: onboarding.customerId, status, kyc_status: onboarding.kycStatus };
}

/** The customer's bank account state, and what they can do next. Bridge is the authority for everything shown. */
export const GET = route("money.account", { unavailable: "account_unavailable" }, async (request) => {
  const subject = await requireVerifiedSubject(request);
  const bridge = await bridgeClient(env.PROJECTION_DB);
  if (!bridge) return Response.json({ available: false, account: previewMoneyAccount(), nextAction: null });
  let link = await env.PROJECTION_DB.prepare("SELECT external_customer_id, onboarding_reference, status, kyc_status, onboarding_url FROM provider_customer_links WHERE subject_reference = ? AND provider = 'bridge'")
    .bind(subject.subjectReference).first<Link>();
  if (link && !link.external_customer_id && link.onboarding_reference) link = await refresh(bridge, subject.subjectReference, link);
  if (!link) return Response.json({ available: true, account: previewMoneyAccount(), nextAction: { type: "start_verification" } });
  if (link.status !== "active" || !link.external_customer_id) {
    return Response.json({ available: true, account: previewMoneyAccount(), verification: { status: link.status, kycStatus: link.kyc_status },
      nextAction: link.status === "pending" && link.onboarding_url ? { type: "continue_verification", url: link.onboarding_url } : null });
  }
  const customerId = link.external_customer_id;
  let account = await getUsdAccount(bridge, customerId);
  if (account.state === "setup_required") {
    // First read after Bridge approves the customer: open the USD account into their smart wallet.
    await openUsdAccount(bridge, customerId, await requireActionWallet(subject.subjectReference));
    account = await getUsdAccount(bridge, customerId);
  }
  return Response.json({ available: true, account, nextAction: null });
});
