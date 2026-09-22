import type { Metadata } from "next";
import { PublicProductTour } from "@/components/public-product-tour";

export const metadata: Metadata = { title: "Product tour — Aurel", description: "See how Aurel brings visibility, control, transfers, and support into one clear experience." };
export default function TourPage() { return <PublicProductTour />; }
