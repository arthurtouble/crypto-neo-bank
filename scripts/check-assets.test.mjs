import assert from "node:assert/strict";
import test from "node:test";
import { checkAssets, decodeSymbol } from "./check-assets.mjs";

const token = { id: "8453:0x0000000000000000000000000000000000000abc", chainId: 8453, address: "0x0000000000000000000000000000000000000abc",
  symbol: "USDC", name: "USD Coin", decimals: 6 };
const word = (value) => `0x${value.toString(16).padStart(64, "0")}`;
const abiString = (text) => `0x${word(32).slice(2)}${word(text.length).slice(2)}${Buffer.from(text).toString("hex").padEnd(64, "0")}`;

function chain({ code = "0x6080", decimals = 6, symbol = abiString("USDC") } = {}) {
  return async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    const result = method === "eth_getCode" ? code : params[0].data === "0x313ce567" ? word(decimals) : symbol;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
}

test("an asset whose contract, decimals, and symbol match passes", async () => {
  const result = await checkAssets({ assets: [token], fetcher: chain(), env: {} });
  assert.equal(result.ok, true);
  assert.match(result.lines[0], /^ok {4}USDC/);
});

test("a missing contract, wrong decimals, or wrong symbol fails", async () => {
  for (const [fetcher, reason] of [[chain({ code: "0x" }), /no contract code/], [chain({ decimals: 18 }), /18 decimals/], [chain({ symbol: abiString("USDT") }), /symbol is "USDT"/]]) {
    const result = await checkAssets({ assets: [token], fetcher, env: {} });
    assert.equal(result.ok, false);
    assert.match(result.lines[0], reason);
  }
});

test("a native coin must have 18 decimals and needs no RPC", async () => {
  const native = { ...token, id: "8453:native", address: null, symbol: "ETH", decimals: 18 };
  assert.equal((await checkAssets({ assets: [native], fetcher: () => { throw new Error("no call expected"); }, env: {} })).ok, true);
  assert.equal((await checkAssets({ assets: [{ ...native, decimals: 6 }], fetcher: chain(), env: {} })).ok, false);
});

test("symbols decode from ABI strings and from bytes32", () => {
  assert.equal(decodeSymbol(abiString("cbBTC")), "cbBTC");
  assert.equal(decodeSymbol(`0x${Buffer.from("MKR").toString("hex").padEnd(64, "0")}`), "MKR");
});

test("a Base B20 token (a precompile with a 0xef marker) passes, and its Chainlink feed must match", async () => {
  const stock = { ...token, symbol: "AAPLc", decimals: 8,
    price: { kind: "chainlink", feed: "0x0000000000000000000000000000000000000fee", decimals: 8, maxAgeSeconds: 345600, label: "Coinbase AAPL" } };
  const feedChain = ({ description = "Coinbase AAPL", feedDecimals = 8, answer = 34_151_300_000n } = {}) => async (_url, init) => {
    const { method, params } = JSON.parse(init.body);
    if (method === "eth_getCode") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xef" }));
    const { to, data } = params[0];
    const feed = to === stock.price.feed;
    const result = data === "0x313ce567" ? word(feed ? feedDecimals : 8) : data === "0x95d89b41" ? abiString("AAPLc")
      : data === "0x7284e416" ? abiString(description) : `0x${word(1).slice(2)}${word(answer).slice(2)}${word(0).slice(2).repeat(3)}`;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  const passing = await checkAssets({ assets: [stock], fetcher: feedChain(), env: {} });
  assert.equal(passing.ok, true);
  assert.match(passing.lines[0], /price feed Coinbase AAPL/);
  for (const [fetcher, reason] of [[feedChain({ description: "Coinbase AMZN" }), /price feed is "Coinbase AMZN"/],
    [feedChain({ feedDecimals: 18 }), /price feed has 18 decimals/], [feedChain({ answer: 0n }), /no positive answer/]]) {
    const result = await checkAssets({ assets: [stock], fetcher, env: {} });
    assert.equal(result.ok, false);
    assert.match(result.lines[0], reason);
  }
});
