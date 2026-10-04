import { redirect } from "next/navigation";

/** Insights became the summary at the top of Transactions on 4 October 2026. Old links and bookmarks open Transactions. */
export default function InsightsPage() {
  redirect("/app/transactions");
}
