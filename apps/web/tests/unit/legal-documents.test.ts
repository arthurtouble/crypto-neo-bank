import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { legalDocuments } from "@/lib/legal/documents";

const docs = resolve(import.meta.dirname, "../../../docs/src/content/docs");

/**
 * Settings → Your data links to the terms and privacy notice the customer accepted. The terms gate asks again for
 * each new version, so those are the documents at these paths, as long as the published page carries the version
 * the app asks customers to accept.
 */
describe("legal documents", () => {
  for (const [name, document] of Object.entries(legalDocuments)) {
    it(`the published ${name} page is the version the app asks customers to accept`, () => {
      const page = readFileSync(resolve(docs, `${document.path.replace(/^\/|\/$/g, "")}.md`), "utf8");
      expect(page).toContain(`**Version:** ${document.version}`);
    });
  }
});
