import { getCollection, type CollectionEntry } from "astro:content";

/**
 * The docs for AI assistants and search tools (llmstxt.org): /llms.txt lists every page with its description, and
 * /llms-full.txt has every page's text in one file. Both are built from the content collection, so they list exactly
 * the pages the site has.
 */
type Page = CollectionEntry<"docs">;

/** Sections in the order the sidebar shows them, by folder. Pages in a folder not listed here come last. */
const sections: [folder: string, label: string][] = [
  ["getting-started", "Start here"],
  ["concepts", "Understand Aura"],
  ["product", "Accounts and money"],
  ["safety", "Safety"],
  ["company", "Company"],
  ["legal", "Legal"]
];

export const summary = "Aura is a money app. Hold stablecoins, crypto, tokenized stocks, and gold, then send, swap, and earn from one wallet. You confirm every payment with your passkey. What you can use depends on where you live.";

/** The page's path on the site: `index` is the home page, and `legal/index` is /legal/. */
export const pathOf = (page: Page) => (page.id === "index" ? "/" : `/${page.id.replace(/\/?index$/, "")}/`);

const folderOf = (page: Page) => (page.id.includes("/") ? page.id.split("/")[0] : "");
const orderOf = (page: Page) => page.data.sidebar?.order ?? Number.MAX_SAFE_INTEGER;

/** Every published page, grouped by section in sidebar order; within a section, by sidebar order then title. */
export async function pagesBySection() {
  const pages = (await getCollection("docs", (page) => !page.data.draft)).filter((page) => page.id !== "index" && page.id !== "404");
  const byTitle = (a: Page, b: Page) => orderOf(a) - orderOf(b) || a.data.title.localeCompare(b.data.title);
  const known = new Set(sections.map(([folder]) => folder));
  const grouped = sections.map(([folder, label]) => ({ label, pages: pages.filter((page) => folderOf(page) === folder).sort(byTitle) }));
  const other = pages.filter((page) => !known.has(folderOf(page))).sort(byTitle);
  return [...grouped, ...(other.length ? [{ label: "More", pages: other }] : [])].filter((section) => section.pages.length);
}

/** A page's Markdown without MDX imports, for /llms-full.txt. */
export const plainBody = (page: Page) => (page.body ?? "").replace(/^import .*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();

export const text = (body: string) => new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
