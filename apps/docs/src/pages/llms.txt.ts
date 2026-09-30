import type { APIRoute } from "astro";
import { pagesBySection, pathOf, summary, text } from "../lib/llms";

// /llms.txt: every docs page with its description, for AI assistants and search tools (src/lib/llms.ts).
export const GET: APIRoute = async ({ site }) => {
  const url = (path: string) => (site ? new URL(path, site).href : path);
  const sections = await pagesBySection();
  const body = [
    "# Aura documentation",
    "",
    `> ${summary}`,
    "",
    `How Aura works, what you can use today, and how to keep your money safe. Every page's text is in one file at ${url("/llms-full.txt")}.`,
    ...sections.flatMap(({ label, pages }) => ["", `## ${label}`, "", ...pages.map((page) =>
      `- [${page.data.title}](${url(pathOf(page))})${page.data.description ? `: ${page.data.description}` : ""}`)])
  ].join("\n");
  return text(`${body}\n`);
};
