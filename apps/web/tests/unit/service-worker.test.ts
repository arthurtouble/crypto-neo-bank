import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Run public/sw.js against a fake service worker scope and click a notification carrying `link`. */
async function click(link: unknown, windows: Array<{ url: string }> = []) {
  const listeners: Record<string, (event: unknown) => void> = {};
  const opened: string[] = [];
  const navigated: string[] = [];
  const self = {
    location: { origin: "https://aura.test" },
    addEventListener: (type: string, listener: (event: unknown) => void) => { listeners[type] = listener; },
    registration: { showNotification: async () => undefined },
    clients: {
      matchAll: async () => windows.map((client) => ({ ...client, navigate: async (url: string) => { navigated.push(url); return { focus: () => undefined }; } })),
      openWindow: async (url: string) => { opened.push(url); }
    }
  };
  new Function("self", readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8"))(self);
  let work: Promise<unknown> = Promise.resolve();
  listeners.notificationclick({ notification: { close: () => undefined, data: { link } }, waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
  return { opened, navigated };
}

describe("service worker notification clicks (security review B9)", () => {
  it("opens a path in the app", async () => {
    expect((await click("/app/cards")).opened).toEqual(["https://aura.test/app/cards"]);
    expect((await click("/app/settings", [{ url: "https://aura.test/app" }])).navigated).toEqual(["https://aura.test/app/settings"]);
  });

  it("opens only Aura, whatever link a notification carries", async () => {
    for (const link of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "https://aura.test.evil.example/app", null]) {
      expect((await click(link)).opened, String(link)).toEqual(["https://aura.test/app"]);
    }
  });
});
