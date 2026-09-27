import { MORPHO_VAULTS, morphoVaultRates } from "@/lib/defi/morpho";
import { route } from "@/lib/http/route";

/** The Morpho vaults Aura offers, with each one's rate, deposits, and withdrawable liquidity. Public market data. */
export const GET = route("defi.morpho.vaults", { unavailable: "vaults_unavailable" }, async () => {
  const rates = await morphoVaultRates();
  return Response.json({
    vaults: MORPHO_VAULTS.map((vault) => ({ id: vault.id, address: vault.address, name: vault.name, curator: vault.curator, assetSymbol: vault.assetSymbol,
      rate: rates?.rates.find((rate) => rate.vaultId === vault.id) ?? null })),
    observedAt: rates?.observedAt ?? null, source: rates ? rates.source : null
  }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
});
