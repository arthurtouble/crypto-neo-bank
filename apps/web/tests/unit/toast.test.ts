import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addToast, ToastProvider, useToast, type Toast } from "@/components/toast";

const toast = (id: number, title = `Toast ${id}`, key?: string): Toast => ({ id, tone: "error", title, key });

describe("toasts", () => {
  it("stacks a new toast under the ones still showing, however many arrive at once", () => {
    const list = [1, 2, 3, 4, 5].reduce<Toast[]>((current, id) => addToast(current, toast(id)), []);
    expect(list.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("stacks different toasts that share a key, such as two Settings changes", () => {
    const list = addToast([toast(1, "Email notices on", "settings")], toast(2, "Price alerts off", "settings"));
    expect(list.map((item) => item.id)).toEqual([1, 2]);
  });

  it("shows a repeat of the same message once, in the newest place", () => {
    const list = addToast(addToast([toast(1, "Add a passkey to move money"), toast(2)], toast(3)), toast(4, "Add a passkey to move money"));
    expect(list.map((item) => item.id)).toEqual([2, 3, 4]);
  });

  it("renders an empty notification region, and components outside the provider still render", () => {
    function Child() { useToast().success("Saved"); return createElement("p", null, "content"); }
    expect(renderToStaticMarkup(createElement(ToastProvider, null, createElement(Child)))).toContain('aria-label="Notifications"');
    expect(renderToStaticMarkup(createElement(Child))).toBe("<p>content</p>");
  });
});
