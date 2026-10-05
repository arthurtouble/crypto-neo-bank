import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Notice, SupportText } from "@/components/states";
import { failureText } from "@/lib/client/action-copy";

const render = (text: string) => renderToStaticMarkup(createElement(SupportText, { text }));

describe("SupportText", () => {
  it("links the words that send a customer to support", () => {
    expect(render(failureText("delivery_failed"))).toBe('Delivery failed. <a class="appTextButton mxInlineButton" href="/app/support">Contact support</a> before you try again.');
    expect(render("This account is closed. Contact support if you need help.")).toContain('<a class="appTextButton mxInlineButton" href="/app/support">Contact support</a> if you need help.');
  });

  it("keeps the case the sentence uses", () => {
    expect(render("Try again, or contact support.")).toBe('Try again, or <a class="appTextButton mxInlineButton" href="/app/support">contact support</a>.');
  });

  it("leaves other text alone", () => {
    expect(render(failureText("transaction_reverted"))).toBe("The network rejected it. Nothing moved.");
  });

  it("is what a Notice does with plain text", () => {
    // eslint-disable-next-line react/no-children-prop -- Notice's props type requires children.
    expect(renderToStaticMarkup(createElement(Notice, { tone: "error", children: "Bridge couldn't return the money. Contact support" }))).toContain('href="/app/support"');
  });
});
