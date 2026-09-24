import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("fresh growth schema keeps waitlist and beta invites without application tables", () => {
  const db = new DatabaseSync(":memory:");
  const migrations = resolve(process.cwd(), "../../infra/d1/migrations");
  for (const file of readdirSync(migrations).sort()) db.exec(readFileSync(resolve(migrations, file), "utf8"));
  const names = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name));
  expect(names.has("growth_waitlist")).toBe(true);
  expect(names.has("growth_waitlist_invites")).toBe(true);
  expect(names.has("beta_invites")).toBe(true);
  for (const name of ["growth_applications", "growth_subject_links", "growth_attribution", "growth_research_notes"]) expect(names.has(name)).toBe(false);
  db.close();
});
