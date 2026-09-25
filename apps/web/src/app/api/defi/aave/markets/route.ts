import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { getAaveBaseMarkets } from "@/lib/defi/aave";
import { errorResponse, route } from "@/lib/http/route";

export const GET = route("defi.aave.markets", { unavailable: "market_unavailable", unavailableMessage: "Live Aave market data is temporarily unavailable." }, async (request: Request, context) => {
  const address = new URL(request.url).searchParams.get("address") ?? undefined;
  if (address && !/^0x[a-fA-F0-9]{40}$/.test(address)) return errorResponse(400, "invalid_address", context);
  if (address) {
    const subject = await requireVerifiedSubject(request);
    await requireLinkedEvmWallet(subject.subjectReference, address);
  }
  const market = await getAaveBaseMarkets(address);
  return Response.json(market, { headers: { "Cache-Control": address ? "private, no-store" : "public, max-age=15, s-maxage=30, stale-while-revalidate=120", "X-Aurel-Data-Authority": "aave-and-base" } });
});
