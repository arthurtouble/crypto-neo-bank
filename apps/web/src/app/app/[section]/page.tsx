import { notFound, redirect } from "next/navigation";
import { legacySectionDestination } from "@/lib/product-map";

/** Each section has its own route, so it ships only its own code. This one sends old section names on, and 404s the rest. */
export default async function OldSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const destination = legacySectionDestination((await params).section);
  if (destination) redirect(destination);
  notFound();
}
