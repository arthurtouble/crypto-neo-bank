import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailTokens, renderNoticeEmail } from "@/lib/notifications/email";

const tokens = readFileSync(new URL("../../public/design-tokens.css", import.meta.url), "utf8");
/** The value of a token in the light (:root) or dark ([data-theme="dark"]) block. */
function token(name: string, theme: "light" | "dark") {
  const block = theme === "light" ? tokens.slice(0, tokens.indexOf("@media")) : tokens.slice(tokens.indexOf('[data-theme="dark"]'));
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim();
}

describe("notice emails", () => {
  it("use the design tokens' values, since email clients can't read CSS variables", () => {
    const names = { canvas: "color-canvas", surface: "color-surface", text: "color-text", textSecondary: "color-text-secondary", textTertiary: "color-text-tertiary",
      line: "color-line", accent: "color-accent", onAccent: "color-on-accent", negative: "color-negative", positive: "color-positive" } as const;
    for (const theme of ["light", "dark"] as const) {
      for (const [key, name] of Object.entries(names)) expect(emailTokens[theme][key as keyof typeof names], `${theme} ${name}`).toBe(token(name, theme));
    }
    expect(emailTokens.radius).toEqual({ sm: token("radius-sm", "light"), lg: token("radius-lg", "light") });
  });

  it("render the notice with one action, escaped, and a plain-text copy", () => {
    const email = renderNoticeEmail({ kind: "received", title: "Received 1 USDC", body: "From 0xab…cd <script>, on Base." }, "https://aura.test/app/transactions?open=a&b");
    expect(email.subject).toBe("Received 1 USDC");
    expect(email.html).toContain("Money received");
    expect(email.html).toContain("From 0xab…cd &lt;script&gt;, on Base.");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain('href="https://aura.test/app/transactions?open=a&amp;b"');
    expect(email.html.match(/<a /g)).toHaveLength(1);
    // Every style attribute stays whole: a double quote inside one would end it early.
    for (const [, style] of email.html.matchAll(/style="([^"]*)"/g)) expect(style).not.toMatch(/(^|;)\s*[a-z-]+:\s*$/);
    expect(email.html).toContain("'Segoe UI'");
    expect(email.text).toContain("Open in Aura: https://aura.test/app/transactions?open=a&b");
    expect(email.text).toContain("turn off transaction emails");
  });

  it("say security notices are always sent", () => {
    const email = renderNoticeEmail({ kind: "security", title: "Account locked", body: "Your account is locked." }, "https://aura.test/app/settings");
    expect(email.html).toContain("Security notices are always sent");
    expect(email.text).not.toContain("turn off transaction emails");
  });
});
