import { getAaveBaseMarkets } from "@/lib/defi/aave";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") ?? undefined;
  if (address && !/^0x[a-fA-F0-9]{40}$/.test(address)) return Response.json({ error: "invalid_address" }, { status: 400 });
  try {
    if (address) {
      const subject = await requireVerifiedSubject(request);
      await requireLinkedEvmWallet(subject.subjectReference, address);
    }
    const market = await getAaveBaseMarkets(address);
    return Response.json(market, { headers: { "Cache-Control": address ? "private, no-store" : "public, max-age=15, s-maxage=30, stale-while-revalidate=120", "X-Aurel-Data-Authority": "aave-and-base" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (error instanceof WalletOwnershipError) return Response.json({ error: "wallet_not_linked" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    console.error(JSON.stringify({ level: "error", event: "aave.markets.failed", message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "market_unavailable", message: "Live Aave market data is temporarily unavailable." }, { status: 503 });
  }
}
