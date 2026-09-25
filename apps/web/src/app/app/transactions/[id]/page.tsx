import { TransactionDetail } from "@/components/transaction-detail";

export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <TransactionDetail id={(await params).id} />;
}
