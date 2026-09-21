import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    mode: process.env.PRODUCT_MODE ?? "mainnet-preview",
    service: "aurel-web",
    platform: "cloudflare-workers",
    financialDataAuthority: "providers-and-chains",
  });
}
