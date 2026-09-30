import type { APIRoute } from "astro";

// Production docs are indexed, with the sitemap Starlight builds from `site`. The dev deploy sets AURA_DOCS_NOINDEX.
export const GET: APIRoute = ({ site }) => {
  const body = process.env.AURA_DOCS_NOINDEX === "1"
    ? "User-agent: *\nDisallow: /\n"
    : `User-agent: *\nAllow: /\n${site ? `\nSitemap: ${new URL("sitemap-index.xml", site).href}\n` : ""}`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
