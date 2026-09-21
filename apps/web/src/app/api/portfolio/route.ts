import { createDemoRegistry } from "@/lib/providers/demo";
import { rebuildPortfolioProjection } from "@/lib/projections/portfolio";

export async function GET() {
  const providers = createDemoRegistry("funded");
  const projection = await rebuildPortfolioProjection("demo-client-00184", [
    providers.fiat,
    providers.wallet,
  ]);

  return Response.json(projection, {
    headers: {
      "Cache-Control": "no-store",
      "X-Aurel-Data-Authority": "provider-and-chain",
    },
  });
}
