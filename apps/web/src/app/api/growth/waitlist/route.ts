export async function POST() {
  return Response.json({ error: "waitlist_closed", message: "Explore Aura without signing up." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
