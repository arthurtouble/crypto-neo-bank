import { env } from "cloudflare:workers";
import { lookupPublicTag } from "@/lib/aura-tag-public";

/** A public payment page's details (lib/aura-tag-public.ts). Every failure looks the same, so tags cannot be probed. */
export async function GET(request: Request, { params }: { params: Promise<{ tag: string }> }) {
  const result = await lookupPublicTag(env.PROJECTION_DB, (await params).tag, request.headers.get("cf-connecting-ip"));
  if (result.status === "rate_limited") return Response.json({ error: "rate_limited" }, { status: 429, headers: { "Cache-Control": "no-store", ...result.headers } });
  if (result.status === "unavailable") return Response.json({ error: "tag_unavailable" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return Response.json(result.payment, { headers: { "Cache-Control": "no-store" } });
}
