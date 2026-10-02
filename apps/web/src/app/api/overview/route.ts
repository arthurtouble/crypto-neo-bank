import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionWallet } from "@/lib/auth/wallet";
import { route } from "@/lib/http/route";
import { readOverview } from "@/lib/overview/read";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/** Cash, vaults, and portfolio for the customer's Aura wallet, read from the chains. */
export const GET = route("overview.get", { unavailable: "overview_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "overview", subject: subject.subjectReference, limit: 60, windowSeconds: 60 });
  const overview = await readOverview(await requireActionWallet(subject.subjectReference));
  // With no balance read at all, there is nothing to total: the whole Overview is unavailable, never $0.00.
  if (overview.holdings.every((holding) => holding.status === "unavailable")) throw new Error("no balance could be read");
  return Response.json({ ...overview, traceId });
});
