import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

type SidebarEntry = { type: "link"; href: string; label: string } | { type: "group"; entries: SidebarEntry[] };
const links = (entries: SidebarEntry[]): { href: string; label: string }[] =>
  entries.flatMap((entry) => (entry.type === "group" ? links(entry.entries) : [entry]));

/**
 * A BreadcrumbList (schema.org) on every page but the home page, so search results show where a page sits: the docs
 * home, then the section's own page when it has one (such as /legal/), then the page.
 */
export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const path = context.url.pathname;
  if (!context.site || path === "/") return;
  const pages = links(route.sidebar as SidebarEntry[]);
  const folder = `/${path.split("/").filter(Boolean)[0]}/`;
  const section = folder !== path ? pages.find((page) => page.href === folder) : undefined;
  const trail = [
    { name: "Aura docs", path: "/" },
    ...(section ? [{ name: section.label, path: section.href }] : []),
    { name: route.entry.data.title, path }
  ];
  const data = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: new URL(item.path, context.site).href }))
  };
  route.head.push({ tag: "script", attrs: { type: "application/ld+json" }, content: JSON.stringify(data).replace(/</g, "\\u003c") });
});
