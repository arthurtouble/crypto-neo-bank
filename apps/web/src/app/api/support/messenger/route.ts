import { requireVerifiedSubject } from "@/lib/auth/server";
import { privyEmail } from "@/lib/auth/privy";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { intercomConfig, intercomUserToken } from "@/lib/support/intercom";

/**
 * What the app needs to open the support chat as this customer: Intercom's app
 * ID and a signed identity token. A closed account can still ask for help.
 * `appId: null` means support chat isn't set up on this server.
 */
export const GET = route("support.messenger.get", { unavailable: "support_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request, { allowClosed: true, beforeTerms: true });
  const config = intercomConfig();
  if (!config) return Response.json({ appId: null, traceId }, { headers: { "Cache-Control": "no-store" } });
  const [email, wallet] = await Promise.all([privyEmail(subject.subjectReference).catch(() => null), requireActionWallet(subject.subjectReference)]);
  const { token, expiresAt } = await intercomUserToken({ userId: subject.subjectReference, email }, config.secret);
  return Response.json({ appId: config.appId, userId: subject.subjectReference, token, expiresAt, walletAddress: wallet.toLowerCase(), traceId },
    { headers: { "Cache-Control": "no-store" } });
});
