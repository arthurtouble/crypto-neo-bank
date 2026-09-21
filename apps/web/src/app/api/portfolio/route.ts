import { DemoBridgeAdapter, DemoOnchainAdapter } from "@/lib/providers/demo";
import { rebuildPortfolioProjection } from "@/lib/projections/portfolio";

export async function GET() {
  const projection = await rebuildPortfolioProjection("demo-client-00184", [
    new DemoBridgeAdapter(),
    new DemoOnchainAdapter(),
  ]);

  return Response.json(projection, {
    headers: {
      "Cache-Control": "no-store",
      "X-Aurel-Data-Authority": "provider-and-chain",
    },
  });
}

