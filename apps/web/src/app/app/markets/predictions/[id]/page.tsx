import { PredictionMarketPage } from "@/components/prediction-market";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PredictionMarketPage id={(await params).id} />;
}
