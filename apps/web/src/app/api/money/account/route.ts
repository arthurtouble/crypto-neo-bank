import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { requireActionWallet } from "@/lib/auth/wallet";
import { bridgeClient, getUsdAccount, openUsdAccount } from "@/lib/providers/bridge";
import { previewMoneyAccount } from "@/lib/providers/service-catalog";

type Link = { external_customer_id: string; status: string; kyc_status: string | null; onboarding_url: string | null };

/** The customer's bank account state, and what they can do next. Bridge is the authority for everything shown. */
export const GET = route("money.account", { unavailable: "account_unavailable" }, async (request) => {
  const subject = await requireVerifiedSubject(request);
  const bridge = await bridgeClient(env.PROJECTION_DB);
  if (!bridge) return Response.json({ available: false, account: previewMoneyAccount(), nextAction: null });
  const link = await env.PROJECTION_DB.prepare("SELECT external_customer_id, status, kyc_status, onboarding_url FROM provider_customer_links WHERE subject_reference = ? AND provider = 'bridge'")
    .bind(subject.subjectReference).first<Link>();
  if (!link) return Response.json({ available: true, account: previewMoneyAccount(), nextAction: { type: "start_verification" } });
  if (link.status !== "active") {
    return Response.json({ available: true, account: previewMoneyAccount(), verification: { status: link.status, kycStatus: link.kyc_status },
      nextAction: link.status === "pending" && link.onboarding_url ? { type: "continue_verification", url: link.onboarding_url } : null });
  }
  let account = await getUsdAccount(bridge, link.external_customer_id);
  if (account.state === "setup_required") {
    // First read after Bridge approves the customer: open the USD account into their smart wallet.
    await openUsdAccount(bridge, link.external_customer_id, await requireActionWallet(subject.subjectReference));
    account = await getUsdAccount(bridge, link.external_customer_id);
  }
  return Response.json({ available: true, account, nextAction: null });
});
