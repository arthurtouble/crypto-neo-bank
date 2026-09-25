import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { BridgeRailAdapter } from "@/lib/providers/bridge";
import { previewMoneyAccount } from "@/lib/providers/service-catalog";

export const GET = route("money.account", { unavailable: "account_unavailable" }, async (request: Request) => {
  const subject = await requireVerifiedSubject(request);
  let account = previewMoneyAccount();
  if (process.env.BRIDGE_MODE === "live") {
    const link = await env.PROJECTION_DB.prepare("SELECT external_customer_id FROM provider_customer_links WHERE subject_reference = ? AND provider = 'bridge' AND status = 'active'").bind(subject.subjectReference).first<{ external_customer_id: string }>();
    if (link && process.env.BRIDGE_API_KEY) account = await new BridgeRailAdapter(process.env.BRIDGE_API_KEY, process.env.BRIDGE_API_BASE_URL).getUsdAccount(link.external_customer_id);
  }
  return Response.json({
    account,
    customerReference: subject.subjectReference,
    nextAction: { type: "verify_identity", label: "Set Up Bank Transfers" }
  });
});
