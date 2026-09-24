export function GET() {
  return Response.json({
    error: "legacy_demo_endpoint_removed",
    message: "Portfolio data is available only inside an authenticated Aura session. The product reads balances directly from providers and public chains.",
  }, {
    status: 410,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
