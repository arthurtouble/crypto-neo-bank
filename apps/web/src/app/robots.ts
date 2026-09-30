import type { MetadataRoute } from "next";
import { indexable, privatePaths, siteOrigin } from "@/lib/site/seo";

export default function robots(): MetadataRoute.Robots {
  if (!indexable()) return { rules: { userAgent: "*", disallow: "/" } };
  const origin = siteOrigin();
  return { rules: { userAgent: "*", allow: "/", disallow: privatePaths }, ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}) };
}
