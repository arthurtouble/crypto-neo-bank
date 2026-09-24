export async function GET() {
  return Response.json({ error: "markets_list_retired" }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
