import { PerpsMarketPage } from "@/components/perps-market";

/** A perp's name may arrive encoded ("xyz%3ASPCX" for the stock perp xyz:SPCX). */
const decoded = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

export default async function Page({ params }: { params: Promise<{ coin: string }> }) {
  return <PerpsMarketPage coin={decoded((await params).coin)} />;
}
