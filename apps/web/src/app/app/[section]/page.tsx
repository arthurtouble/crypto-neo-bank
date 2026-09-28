import { notFound, redirect } from "next/navigation";
import { SectionPage } from "@/components/section-page";
import { customerSections, legacySectionDestination, type CustomerSection } from "@/lib/product-map";

const sections = customerSections;

export function generateStaticParams() {
  return sections.map((section) => ({ section }));
}

export default async function ProductSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const oldDestination = legacySectionDestination(section);
  if (oldDestination) redirect(oldDestination);
  if (!sections.includes(section as CustomerSection)) notFound();
  return <SectionPage section={section as CustomerSection} />;
}
