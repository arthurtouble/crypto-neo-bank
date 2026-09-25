import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { getAaveBasePosition } from "@/lib/defi/aave";
import { errorResponse, route } from "@/lib/http/route";

export const GET = route("defi.aave.positions", { unavailable: "position_unavailable" }, async (request: Request, context) => {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return errorResponse(400, "invalid_address", context);
  const subject = await requireVerifiedSubject(request);
  await requireLinkedEvmWallet(subject.subjectReference, address);
  const position = await getAaveBasePosition(address);
  return Response.json(position, { headers: { "Cache-Control": "private, no-store", "X-Aurel-Data-Authority": "aave-and-base" } });
});
