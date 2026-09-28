import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

const edgeUrl = `http://127.0.0.1:${process.env.AUREL_E2E_EDGE_PORT ?? "43174"}`;

/**
 * Every spec's `test`. The browser's fake wallet and chain reads call
 * https://edge.aura-e2e.test, which this forwards to the fake edge, so the
 * app keeps its deployed Content Security Policy. Intercom's Messenger script
 * is a fake that records every call in window.__intercomCalls. Stripe.js is a
 * fake whose card frames show the card only for an ephemeral key the fake
 * Stripe made for that card and nonce.
 */
export const test = base.extend<{ edgeRoute: void }>({
  edgeRoute: [async ({ context }, use) => {
    await context.route("https://edge.aura-e2e.test/**", async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `${edgeUrl}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
    await context.route("https://widget.intercom.io/**", (route) => route.fulfill({ contentType: "application/javascript", body: `(() => {
      const calls = (window.__intercomCalls = window.__intercomCalls || []);
      const queued = (window.Intercom && window.Intercom.q) || [];
      window.Intercom = (...args) => { calls.push(JSON.parse(JSON.stringify(args))); };
      for (const args of queued) window.Intercom(...args);
    })();` }));
    await context.route("https://js.stripe.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: `(() => {
      window.Stripe = (publishableKey) => {
        if (!publishableKey.startsWith("pk_")) throw new Error("bad key");
        let revealed = null;
        const text = { issuingCardNumberDisplay: "number", issuingCardExpiryDisplay: "expiry", issuingCardCvcDisplay: "cvc" };
        return {
          createEphemeralKeyNonce: async () => ({ nonce: "ephkn_pub_" + Math.random().toString(36).slice(2) }),
          retrieveIssuingCard: async (cardId, { ephemeralKeySecret, nonce }) => {
            const response = await fetch("https://edge.aura-e2e.test/stripe-js/reveal", { method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ cardId, ephemeralKeySecret, nonce }) });
            if (!response.ok) return { error: { message: "Invalid ephemeral key" } };
            revealed = await response.json();
            return {};
          },
          elements: () => ({ create: (type, options) => ({
            mount: (target) => {
              const node = typeof target === "string" ? document.querySelector(target) : target;
              if (type === "issuingAddToWalletButton") {
                const button = document.createElement("button");
                button.textContent = options.wallet === "apple" ? "Add to Apple Wallet" : "Add to Google Pay";
                node.appendChild(button);
              } else node.textContent = revealed ? revealed[text[type]] : "";
            },
            destroy: () => {}
          }) })
        };
      };
    })();` }));
    await use();
  }, { auto: true }]
});
