import type { APIRoute } from "astro";
import { pagesBySection, pathOf, plainBody, summary, text } from "../lib/llms";

// /llms-full.txt: every docs page's text in one Markdown file, in sidebar order (src/lib/llms.ts).
export const GET: APIRoute = async ({ site }) => {
  const url = (path: string) => (site ? new URL(path, site).href : path);
  const pages = (await pagesBySection()).flatMap((section) => section.pages);
  const body = [`# Aura documentation\n\n> ${summary}`, ...pages.map((page) =>
    [`# ${page.data.title}`, `Source: ${url(pathOf(page))}`, page.data.description ? `> ${page.data.description}` : "", plainBody(page)].filter(Boolean).join("\n\n"))];
  return text(`${body.join("\n\n---\n\n")}\n`);
};
