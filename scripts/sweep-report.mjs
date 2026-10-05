// Turns the quality-bar sweep's findings (output/sweep/*.json, from apps/web/tests/e2e/sweep.spec.ts) into
// output/sweep/report.md: one section per page, each finding once with the themes, sign-in states, and widths it was seen at.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve(import.meta.dirname, "../output/sweep");
const runs = readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(resolve(dir, name), "utf8")));
const byPage = new Map();
for (const run of runs) {
  const findings = byPage.get(run.path) ?? new Map();
  for (const finding of run.findings) {
    const key = `${finding.check}|${finding.detail}`;
    const entry = findings.get(key) ?? { ...finding, widths: new Set(), seen: new Set() };
    for (const width of finding.widths) entry.widths.add(width);
    entry.seen.add(`${run.identity} ${run.theme}`);
    findings.set(key, entry);
  }
  byPage.set(run.path, findings);
}

const lines = ["# Quality-bar sweep", "", `${runs.length} runs over ${byPage.size} pages. Checks: docs/product/design-system.md#quality-bar.`, ""];
let total = 0;
for (const [path, findings] of [...byPage].sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(`## ${path}`, "");
  if (findings.size === 0) { lines.push("Nothing found.", ""); continue; }
  lines.push("| Check | Detail | Widths | Seen |", "| --- | --- | --- | --- |");
  const sorted = [...findings.values()].sort((a, b) => a.check.localeCompare(b.check) || a.detail.localeCompare(b.detail));
  for (const finding of sorted) {
    total += 1;
    const cell = (text) => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
    lines.push(`| ${cell(finding.check)} | ${cell(finding.detail)} | ${[...finding.widths].sort((a, b) => a - b).join(", ") || "all"} | ${[...finding.seen].sort().join(", ")} |`);
  }
  lines.push("");
}
lines.splice(3, 0, `${total} findings.`, "");
writeFileSync(resolve(dir, "report.md"), lines.join("\n"));
console.log(`${total} findings across ${byPage.size} pages: output/sweep/report.md`);
