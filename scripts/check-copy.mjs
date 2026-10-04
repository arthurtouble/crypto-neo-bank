// The banned-words check (docs/product/content-style-guide.md#banned-words): finds words and phrases that
// don't belong in customer copy, in the web app's strings and JSX text and in the public docs.
//
// `node scripts/check-copy.mjs` lists every finding by file. It fails when a file has more findings than
// scripts/copy-baseline.json allows, so new copy can't add them while existing ones are fixed feature by
// feature. `--update` rewrites the baseline to the current counts (only ever lower it). A line ending in
// `copy-check: allow` (in a comment) is skipped, for the rare place the term is right, such as a legal
// definition.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ts = createRequire(join(root, "apps/web/package.json"))("typescript");
const baselinePath = join(root, "scripts/copy-baseline.json");

/** What the content guide bans, and what to write instead. */
export const banned = [
  { pattern: /\brails?\b/i, instead: "say what happens: send, add money, pay by card" },
  { pattern: /\bintents?\b/i, instead: "the action's name" },
  { pattern: /\borchestrat\w*/i, instead: "drop it" },
  { pattern: /\bproviders?\b/i, instead: "the partner's name, or drop it" },
  { pattern: /\bprotocols?\b/i, instead: "Aave or Morpho by name" },
  { pattern: /\b(a|the|this|best|cheapest|fastest|no) routes?\b/i, instead: "drop it, or \"way\"" },
  { pattern: /\bcross-chain\b/i, instead: "between networks" },
  { pattern: /\bon-?chain\b/i, instead: "drop it, or \"on Base\"" },
  { pattern: /\bsettle(ment|d|s)?\b|\bsettling\b/i, instead: "Completed or Pending" },
  { pattern: /\bprojections?\b/i, instead: "drop it" },
  { pattern: /\bnonces?\b/i, instead: "drop it" },
  { pattern: /\bcontrol plane\b/i, instead: "drop it" },
  { pattern: /\bposture\b/i, instead: "drop it" },
  { pattern: /\bslippage\b/i, instead: "\"Price can move by up to …\"" },
  { pattern: /\bbridg(e fee|ing)\b/i, instead: "move from another network, Moving fee" },
  { pattern: /\bwe (couldn['’]t|could not|can['’]t|cannot|were unable|didn['’]t|did not)\b|\bwe (couldn|can|didn)&apos;t\b/i, instead: "\"X can't be loaded right now.\" (no \"we\" in errors)" },
  { pattern: /\binsufficient (balance|funds)\b/i, instead: "\"Not enough [asset]. You have [amount].\"" },
  { pattern: /\b(please|oops|sorry)\b/i, instead: "drop it" }
];

// Operators' screens and the code that only they see may keep precise terms. Legal documents use defined
// terms, and their wording is the owner's decision, not this check's.
const skip = [/\/legal\//, /\/api\/ops\//, /\/lib\/ops\//, /\/lib\/testing\//, /\.test\.tsx?$/, /\.d\.ts$/];
const sources = [
  { dir: "apps/web/src", kind: "code" },
  { dir: "apps/docs/src/content/docs", kind: "docs" }
];

/** Strings a customer could read: JSX text, and string or template literals that look like a sentence. */
function codeStrings(file, text) {
  const out = [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // SQL (two or more upper-case keywords) and contract signatures aren't copy.
  const code = (value) => (value.match(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|WITH|FROM|WHERE|AND|OR|IN|IS|NOT|NULL|VALUES|SET|ORDER BY|LIMIT)\b/g) ?? []).length >= 2
    || /\b(uint\d*|bytes\d*|address)\b[^.]*[;,)]/.test(value) || /^https?:/.test(value);
  const prose = (value) => /[A-Za-z]{2,} [A-Za-z]{2,}/.test(value) && !code(value);
  const visit = (node) => {
    // Logs and thrown programmer errors are for operators, not customers.
    if (ts.isCallExpression(node) && /^console\./.test(node.expression.getText(source))) return;
    let value = null;
    if (ts.isJsxText(node)) value = node.text;
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = prose(node.text) ? node.text : null;
    else if (ts.isTemplateExpression(node)) value = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" … ");
    if (value !== null && value.trim() && (ts.isJsxText(node) || prose(value))) {
      out.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, value });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Docs prose: every line outside code blocks and frontmatter keys other than title and description. */
function docStrings(text) {
  const out = [];
  let code = false; let front = false;
  text.split("\n").forEach((line, index) => {
    if (index === 0 && line === "---") { front = true; return; }
    if (front) { if (line === "---") front = false; else if (/^(title|description):/.test(line)) out.push({ line: index + 1, value: line }); return; }
    if (/^\s*```/.test(line)) { code = !code; return; }
    if (!code) out.push({ line: index + 1, value: line.replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]") });
  });
  return out;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}

export function findings() {
  const found = [];
  for (const { dir, kind } of sources) {
    for (const path of walk(join(root, dir))) {
      const file = relative(root, path);
      if (skip.some((pattern) => pattern.test(`/${file}`))) continue;
      if (kind === "code" && !/\.(ts|tsx)$/.test(file)) continue;
      if (kind === "docs" && !/\.(md|mdx)$/.test(file)) continue;
      const text = readFileSync(path, "utf8");
      const lines = text.split("\n");
      const strings = kind === "code" ? codeStrings(file, text) : docStrings(text);
      for (const { line, value } of strings) {
        if (/copy-check: allow/.test(lines[line - 1] ?? "")) continue;
        for (const rule of banned) {
          const match = value.match(rule.pattern);
          if (match) found.push({ file, line, word: match[0], instead: rule.instead, text: value.trim().replace(/\s+/g, " ").slice(0, 120) });
        }
      }
    }
  }
  return found;
}

export function compare(found, baseline) {
  const counts = {};
  for (const finding of found) counts[finding.file] = (counts[finding.file] ?? 0) + 1;
  const over = Object.entries(counts).filter(([file, count]) => count > (baseline[file] ?? 0));
  const under = Object.entries(baseline).filter(([file, count]) => (counts[file] ?? 0) < count);
  return { counts, over, under };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = findings();
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const { counts, over, under } = compare(found, baseline);
  if (process.argv.includes("--update")) {
    writeFileSync(baselinePath, `${JSON.stringify(Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
    console.log(`Baseline updated: ${found.length} findings in ${Object.keys(counts).length} files.`);
  } else {
    const only = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
    for (const finding of found.filter((item) => !only || item.file.includes(only))) {
      console.log(`${finding.file}:${finding.line}  "${finding.word}" → ${finding.instead}\n    ${finding.text}`);
    }
    for (const [file, count] of under) console.log(`COPY: ${file} is down to ${counts[file] ?? 0} from ${count}; run \`pnpm copy:check --update\` to lock that in.`);
    if (over.length) {
      for (const [file, count] of over) console.error(`COPY ERROR: ${file} has ${count} banned words or phrases, more than its ${baseline[file] ?? 0}. See docs/product/content-style-guide.md#glossary.`);
      process.exitCode = 1;
    } else console.log(`Copy check passed: ${found.length} known findings left in ${Object.keys(counts).length} files.`);
  }
}
