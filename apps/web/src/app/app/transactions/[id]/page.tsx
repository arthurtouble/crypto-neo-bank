import { redirect } from "next/navigation";

/** The Full history page was folded into the receipt on 3 October 2026. Old links open the receipt. */
export default async function TransactionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/app/transactions?open=${encodeURIComponent((await params).id)}`);
}
