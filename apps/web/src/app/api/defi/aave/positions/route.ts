import { getAaveBasePosition } from "@/lib/defi/aave";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return Response.json({ error: "invalid_address" }, { status: 400 });
  try {
    const subject = await requireVerifiedSubject(request);
    await requireLinkedEvmWallet(subject.subjectReference, address);
    const position = await getAaveBasePosition(address);
    return Response.json(position, { headers: { "Cache-Control": "private, no-store", "X-Aurel-Data-Authority": "aave-and-base" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (error instanceof WalletOwnershipError) return Response.json({ error: "wallet_not_linked" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    console.error(JSON.stringify({ level: "error", event: "aave.positions.failed", message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "position_unavailable" }, { status: 503 });
  }
}
