import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = fileURLToPath(new URL("../../src/app/", import.meta.url));
const layout = readFileSync(`${appDir}/layout.tsx`, "utf8");
const system = readFileSync(`${appDir}/product-system.css`, "utf8");

describe("product design-system contract", () => {
  it("loads the authoritative product layer after legacy styles", () => {
    expect(layout.indexOf('import "./product-system.css"')).toBeGreaterThan(layout.indexOf('import "./identity.css"'));
  });

  it("keeps readable semantic type roles", () => {
    expect(system).toContain("--type-caption: 11px");
    expect(system).toContain("--type-label: 12px");
    expect(system).toContain("--type-body-small: 13px");
    expect(system).toContain("--type-body: 14px");
    expect(system).toContain("--type-row-title: 14px");
  });

  it("applies the shared scale to transfer options and capability rows", () => {
    expect(system).toContain(".productShell .transferChoices strong");
    expect(system).toContain(".productShell .transferChoices small");
    expect(system).toContain(".productShell .railRows strong");
    expect(system).toContain(".productShell .railRows small");
    expect(system).toContain("min-height: var(--row-standard)");
  });

  it("covers customer surfaces and portalled financial dialogs", () => {
    for (const selector of [
      ".productShell .tableRow",
      ".productShell .cardControlRow",
      ".productShell .benefitCard p",
      ".productShell .securityChecklist strong",
      ".productShell .settingRow strong",
      ".financialModal .fieldLabel",
      ".dialogContent .transactionSummary strong",
    ]) expect(system).toContain(selector);
  });
});
