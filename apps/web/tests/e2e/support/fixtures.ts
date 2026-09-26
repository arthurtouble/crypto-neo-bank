import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

const edgeUrl = `http://127.0.0.1:${process.env.AUREL_E2E_EDGE_PORT ?? "43174"}`;

/**
 * Every spec's `test`. The browser's fake wallet and chain reads call
 * https://edge.aura-e2e.test, which this forwards to the fake edge, so the
 * app keeps its deployed Content Security Policy.
 */
export const test = base.extend<{ edgeRoute: void }>({
  edgeRoute: [async ({ context }, use) => {
    await context.route("https://edge.aura-e2e.test/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${edgeUrl}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
    await use();
  }, { auto: true }]
});
