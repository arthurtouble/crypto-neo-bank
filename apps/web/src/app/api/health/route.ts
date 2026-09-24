import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";

export async function GET() {
  const observedAt = new Date().toISOString();
  let database: "ok" | "unavailable" = "ok";
  try {
    await env.PROJECTION_DB.prepare("SELECT 1 AS ready").first();
  } catch {
    database = "unavailable";
  }
  const status = database === "ok" ? "ok" : "degraded";
  return NextResponse.json({
    status,
    mode: process.env.PRODUCT_MODE ?? "mainnet-preview",
    service: "aura-web",
    platform: "cloudflare-workers",
    financialDataAuthority: "providers-and-chains",
    dependencies: {
      operationalDatabase: database,
      providerEventQueue: env.PROVIDER_EVENTS ? "configured" : "unavailable",
      customerAuthentication: process.env.PRIVY_APP_SECRET ? "configured" : "unavailable"
    },
    observedAt
  }, { status: status === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
