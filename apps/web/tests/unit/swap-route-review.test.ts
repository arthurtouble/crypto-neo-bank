import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SwapRouteReview } from "@/components/swap-workspace";

describe("swap route review", () => {
  it("offers policy review for a fresh plan without implying a trade has been sent", () => {
    const html = renderToStaticMarkup(createElement(SwapRouteReview, {
      planId: "d917c99a-f60d-4194-a98a-cc0fcdb84569", fresh: true, walletAddress: "0xabc", busy: false,
      state: "idle", onReview() {}
    }));
    expect(html).toContain("Review Swap");
    expect(html).not.toContain("Swap Complete");
    expect(html).not.toContain("Confirm Swap");
  });

  it("does not offer review for an expired or planless quote", () => {
    for (const props of [{ planId: null, fresh: true }, { planId: "plan", fresh: false }]) {
      const html = renderToStaticMarkup(createElement(SwapRouteReview, {
        ...props, walletAddress: "0xabc", busy: false, state: "idle", onReview() {}
      }));
      expect(html).not.toContain("Review Swap</button>");
    }
  });

  it("states clearly that a successful review is not an executed swap", () => {
    const html = renderToStaticMarkup(createElement(SwapRouteReview, {
      planId: "plan", fresh: true, walletAddress: "0xabc", busy: false,
      state: "reviewed", onReview() {}
    }));
    expect(html).toContain("Review Complete");
    expect(html).toContain("No swap has been submitted");
    expect(html).not.toContain("Review Swap</button>");
  });

  it("keeps a prepared route distinct from an executed trade", () => {
    const html = renderToStaticMarkup(createElement(SwapRouteReview, {
      planId: "plan", fresh: true, walletAddress: "0xabc", busy: false,
      state: "prepared", onReview() {}
    }));
    expect(html).toContain("Route Verified");
    expect(html).toContain("No swap has been submitted");
    expect(html).not.toContain("Swap Complete");
  });

  it("names token approval separately when the swap cannot proceed", () => {
    const html = renderToStaticMarkup(createElement(SwapRouteReview, {
      planId: "plan", fresh: true, walletAddress: "0xabc", busy: false,
      state: "approval_required", onReview() {}
    }));
    expect(html).toContain("Token Approval Required");
    expect(html).toContain("No swap has been submitted");
    expect(html).not.toContain("Review Swap</button>");
  });

  it("offers the exact prerequisite only while the quote is fresh", () => {
    const html = renderToStaticMarkup(createElement(SwapRouteReview, {
      planId: "plan", fresh: true, walletAddress: "0xabc", busy: false,
      state: "approval_required", approvalKind: "reset_required", onReview() {}, onApprove() {}
    }));
    expect(html).toContain("Reset Approval</button>");
    expect(html).toContain("does not submit a swap");
    expect(html).not.toContain("Confirm Swap");
    const stale = renderToStaticMarkup(createElement(SwapRouteReview, {
      planId: "plan", fresh: false, walletAddress: "0xabc", busy: false,
      state: "approval_required", approvalKind: "reset_required", onReview() {}, onApprove() {}
    }));
    expect(stale).not.toContain("Reset Approval</button>");
  });

  it("does not call an expired prepared route verified", () => {
    const html = renderToStaticMarkup(createElement(SwapRouteReview, {
      planId: "plan", fresh: false, walletAddress: "0xabc", busy: false,
      state: "prepared", onReview() {}
    }));
    expect(html).toContain("expired");
    expect(html).not.toContain("Route Verified");
  });

  it("offers deliberate wallet confirmation only for a prepared route", () => {
    const html = renderToStaticMarkup(createElement(SwapRouteReview, {
      planId: "plan", fresh: true, walletAddress: "0xabc", busy: false,
      state: "prepared", onReview() {}, onSubmit() {}
    }));
    expect(html).toContain("Confirm Swap");
    expect(html).not.toContain("Swap Complete");
  });

  it("offers a deliberate review for a fresh cross-network quote", () => {
    const html = renderToStaticMarkup(createElement(SwapRouteReview, {
      planId: "plan", fresh: true, walletAddress: "0xabc", busy: false,
      state: "idle", routeKind: "cross_chain", onReview() {}
    }));
    expect(html).toContain("Review Swap</button>");
    expect(html).not.toContain("Confirm Swap</button>");
  });
});
