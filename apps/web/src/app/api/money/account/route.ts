import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { previewMoneyAccount } from "@/lib/providers/service-catalog";
import { BridgeRailAdapter } from "@/lib/providers/bridge";
import { env } from "cloudflare:workers";

export async function GET(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    let account = previewMoneyAccount();
    if (process.env.BRIDGE_MODE === "live") {
      const link = await env.PROJECTION_DB.prepare("SELECT external_customer_id FROM provider_customer_links WHERE subject_reference = ? AND provider = 'bridge' AND status = 'active'").bind(subject.subjectReference).first<{ external_customer_id: string }>();
      if (link && process.env.BRIDGE_API_KEY) account = await new BridgeRailAdapter(process.env.BRIDGE_API_KEY, process.env.BRIDGE_API_BASE_URL).getUsdAccount(link.external_customer_id, "Aurel Member");
    }
    return Response.json({
      account,
      customerReference: subject.subjectReference,
      nextAction: { type: "verify_identity", label: "Set Up Bank Transfers" }
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof AuthenticationError ? "unauthorized" : "account_unavailable" },
      { status: error instanceof AuthenticationError ? 401 : 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
