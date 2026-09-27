import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { parseAssetId } from "@/lib/swap/assets";
import { catalogAsset, getCatalogPage } from "@/lib/swap/catalog";
import { pausedAssets } from "@/lib/assets/pauses";
import { assetFor } from "@/lib/assets/registry";
import { route, errorResponse } from "@/lib/http/route";

const noStore = { "Cache-Control": "no-store" };
const supportedIds = new Set<number>(SUPPORTED_CHAINS.map((chain) => chain.id));

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStore });
}

class InvalidSearch extends Error {}

function parseQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!["q", "chainIds", "import", "held"].includes(key) || params.getAll(key).length !== 1) throw new InvalidSearch("Invalid asset search.");
  }
  const imported = params.get("import");
  if (imported !== null) {
    if (params.size !== 1 || !parseAssetId(imported)) throw new InvalidSearch("Invalid asset ID.");
    return { kind: "import" as const, id: imported };
  }
  const query = params.get("q") ?? "";
  if (query.length > 120) throw new InvalidSearch("Search is too long.");
  const chainList = params.get("chainIds");
  const chainIds = chainList === null ? [...supportedIds] : chainList.split(",").map((value) => {
    if (!/^[1-9]\d*$/.test(value)) throw new InvalidSearch("Invalid network.");
    return Number(value);
  });
  if (chainIds.length < 1 || chainIds.some((id) => !supportedIds.has(id)) || new Set(chainIds).size !== chainIds.length) throw new InvalidSearch("Unsupported network.");
  const held = params.get("held");
  if (held !== null && held !== "1") throw new InvalidSearch("Invalid filter.");
  return { kind: "search" as const, query, chainIds, held: held === "1" };
}

/** Swap's asset list: the registry's swappable assets, searchable. A contract outside the registry is never found. */
export const GET = route("swap.assets", { unavailable: "asset_catalog_unavailable",
  onError: (error, context) => error instanceof InvalidSearch ? errorResponse(400, "invalid_search", context, { message: error.message }) : undefined },
async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_assets", subject: subject.subjectReference, limit: 60, windowSeconds: 600 });
  const input = parseQuery(request);
  if (input.kind === "import") {
    const asset = assetFor(input.id, "swap");
    if (!asset) return json({ error: "asset_not_found", message: "This asset isn't supported.", traceId }, 404);
    return json({ asset: catalogAsset(asset, (await pausedAssets(env.PROJECTION_DB)).get(asset.id)) });
  }
  return json(await getCatalogPage(env.PROJECTION_DB, { query: input.query, chainIds: input.chainIds, held: input.held }));
});
