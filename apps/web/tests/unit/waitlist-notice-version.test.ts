import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("@/components/brand", () => ({ Brand: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/components/growth-tracker", () => ({ GrowthTracker: () => null }));
vi.mock("@/components/waitlist-form", () => ({ WaitlistForm: ({ privacyNoticeVersion }: { privacyNoticeVersion: string }) => createElement("span", { "data-notice-version": privacyNoticeVersion }) }));

import WaitlistPage from "@/app/waitlist/page";

it("uses the server's current privacy notice version for the public form", () => {
  process.env.GROWTH_PRIVACY_NOTICE_VERSION = "new-version";
  expect(renderToString(createElement(WaitlistPage))).toContain('data-notice-version="new-version"');
});
