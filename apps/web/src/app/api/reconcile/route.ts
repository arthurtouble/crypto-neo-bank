export function GET() {
  return Response.json({
    error: "legacy_demo_endpoint_removed",
    message: "Reconciliation is restricted to the allowlisted operations console.",
  }, {
    status: 410,
    headers: { "Cache-Control": "no-store" },
  });
}
