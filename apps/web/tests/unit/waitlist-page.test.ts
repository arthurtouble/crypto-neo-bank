import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/components/turnstile-field", () => ({ TurnstileField: () => null }));

import { WaitlistForm } from "@/components/waitlist-form";
import { WaitlistConfetti } from "@/components/waitlist-confetti";

it("asks for email only and includes an accessible submission control", () => {
  const html = renderToString(createElement(WaitlistForm, { privacyNoticeVersion: "2026-09-23" }));
  expect(html).toContain('type="email"');
  expect(html).toContain('name="email"');
  expect(html).toContain("Join waitlist");
  expect(html).toMatch(/<button[^>]+disabled/);
  expect(html).not.toContain('name="country"');
});

it("keeps celebration visual-only and absent until active", () => {
  expect(renderToString(createElement(WaitlistConfetti, { active: false }))).toBe("");
  const html = renderToString(createElement(WaitlistConfetti, { active: true }));
  expect(html).toContain('data-testid="waitlist-confetti"');
  expect(html).toContain('aria-hidden="true"');
});
