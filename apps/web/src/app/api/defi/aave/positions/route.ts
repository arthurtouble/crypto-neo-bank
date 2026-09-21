import { getAaveBasePosition } from "@/lib/defi/aave";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return Response.json({ error: "invalid_address" }, { status: 400 });
  try {
    const position = await getAaveBasePosition(address);
    return Response.json(position, { headers: { "Cache-Control": "private, max-age=10", "X-Aurel-Data-Authority": "aave-and-base" } });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "aave.positions.failed", message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "position_unavailable" }, { status: 503 });
  }
}

