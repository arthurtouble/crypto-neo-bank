import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { SUPPORTED_CHAINS } from "@/config/chains";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { parseAssetId } from "@/lib/swap/assets";
import { CatalogUnavailableError, getCatalogPage, resolveCatalogAsset } from "@/lib/swap/catalog";

const noStore = { "Cache-Control": "no-store" };
const supportedIds = new Set<number>(SUPPORTED_CHAINS.map((chain) => chain.id));

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

function parseQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!["q", "chainIds", "cursor", "import"].includes(key) || params.getAll(key).length !== 1) {
      throw new Error("Invalid asset search.");
    }
  }
  const imported = params.get("import");
  if (imported !== null) {
    if (params.size !== 1 || !parseAssetId(imported)) throw new Error("Invalid asset ID.");
    return { kind: "import" as const, id: imported };
  }
  const query = params.get("q") ?? "";
  if (query.length > 120) throw new Error("Search is too long.");
  const cursor = params.get("cursor") ?? undefined;
  if (cursor !== undefined && (cursor.length > 2_000 || !/^[A-Za-z0-9_-]+$/.test(cursor))) {
    throw new Error("Invalid search cursor.");
  }
  const chainList = params.get("chainIds");
  const chainIds = chainList === null ? [...supportedIds] : chainList.split(",").map((value) => {
    if (!/^[1-9]\d*$/.test(value)) throw new Error("Invalid network.");
    return Number(value);
  });
  if (chainIds.length < 1 || chainIds.length > supportedIds.size || chainIds.some((id) => !supportedIds.has(id))
    || new Set(chainIds).size !== chainIds.length) throw new Error("Unsupported network.");
  return { kind: "search" as const, query, cursor, chainIds };
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await enforceRateLimit(env.PROJECTION_DB, {
      namespace: "swap_assets", subject: subject.subjectReference, limit: 60, windowSeconds: 600
    });
    const input = parseQuery(request);
    if (input.kind === "import") {
      const asset = await resolveCatalogAsset(input.id);
      return asset ? json({ asset }) : json({ error: "asset_not_found", traceId }, 404);
    }
    return json(await getCatalogPage({ query: input.query, cursor: input.cursor, chainIds: input.chainIds }));
  } catch (error) {
    if (error instanceof AuthenticationError) return json({ error: "unauthorized", traceId }, 401);
    if (error instanceof BetaAccessError) return json({ error: error.code, traceId }, 403);
    if (error instanceof RateLimitError) return json({ error: "rate_limited", traceId }, 429, { "Retry-After": String(error.retryAfterSeconds) });
    if (error instanceof CatalogUnavailableError) {
      const status = error.code === "invalid_cursor" ? 400 : error.code === "stale_cursor" ? 409 : 503;
      return json({ error: error.code, traceId }, status);
    }
    if (error instanceof Error && /^(Invalid|Unsupported|Search is too long)/.test(error.message)) {
      return json({ error: "invalid_search", message: error.message, traceId }, 400);
    }
    console.error(JSON.stringify({ level: "error", event: "swap.catalog_failed", traceId,
      message: error instanceof Error ? error.message : "unknown" }));
    return json({ error: "asset_catalog_unavailable", traceId }, 503);
  }
}
