import { route } from "@/lib/http/route";
import { investAssets, investCategories } from "@/lib/invest/catalog";

/** What can be invested in, by category. Public: it holds no customer data. */
export const GET = route("invest.catalog", { unavailable: "catalog_unavailable" }, async () =>
  Response.json({ categories: investCategories, assets: investAssets }, { headers: { "Cache-Control": "public, max-age=300" } }));
