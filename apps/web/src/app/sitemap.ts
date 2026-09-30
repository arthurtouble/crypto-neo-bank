import type { MetadataRoute } from "next";
import { indexable, publicPaths, siteOrigin } from "@/lib/site/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOrigin();
  if (!indexable() || !origin) return [];
  return publicPaths.map((path) => ({ url: `${origin}${path}`, changeFrequency: "monthly", priority: 1 }));
}
