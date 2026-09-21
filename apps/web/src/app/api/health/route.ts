import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    mode: process.env.NEXT_PUBLIC_PRODUCT_MODE ?? "demo",
    service: "aurel-web",
    platform: "cloudflare-workers",
    financialDataAuthority: "providers-and-chains",
  });
}
