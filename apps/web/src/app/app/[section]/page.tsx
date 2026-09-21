import { notFound } from "next/navigation";
import { SectionPage } from "@/components/section-page";

const sections = ["assets", "earn", "card", "activity", "benefits", "security", "settings"] as const;
type Section = (typeof sections)[number];

export function generateStaticParams() {
  return sections.map((section) => ({ section }));
}

export default async function ProductSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section as Section)) notFound();
  return <SectionPage section={section as Section} />;
}
