import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addToast, ToastProvider, useToast, type Toast } from "@/components/toast";

const toast = (id: number, key?: string): Toast => ({ id, tone: "error", title: `Toast ${id}`, key });

describe("toasts", () => {
  it("replaces a toast with the same key instead of stacking it", () => {
    const list = addToast(addToast([toast(1, "mfa-required"), toast(2)], toast(3)), toast(4, "mfa-required"));
    expect(list.map((item) => item.id)).toEqual([2, 3, 4]);
  });

  it("keeps only the newest three", () => {
    const list = [1, 2, 3, 4].reduce<Toast[]>((current, id) => addToast(current, toast(id)), []);
    expect(list.map((item) => item.id)).toEqual([2, 3, 4]);
  });

  it("renders an empty notification region, and components outside the provider still render", () => {
    function Child() { useToast().success("Saved"); return createElement("p", null, "content"); }
    expect(renderToStaticMarkup(createElement(ToastProvider, null, createElement(Child)))).toContain('aria-label="Notifications"');
    expect(renderToStaticMarkup(createElement(Child))).toBe("<p>content</p>");
  });
});
