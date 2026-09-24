export async function GET() {
  return Response.json({ error: "growth_experiments_retired" }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
