export async function POST() {
  return Response.json({ error: "public_growth_events_retired" }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
