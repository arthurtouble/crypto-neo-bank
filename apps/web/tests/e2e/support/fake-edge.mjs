// A local stand-in for everything outside Aura that end-to-end tests touch:
// Privy's API and its access tokens, a JSON-RPC node for Base and Ethereum, and
// the Kraken price feed. Aura's own server code and local D1 run for real
// against it. Tests change what it returns through /__state and mint sessions
// through /__session.

import { createServer } from "node:http";
import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";

// The public app ID the web app is built with (src/config/client.ts).
export const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmub5evr4013l0cjs0w5dijlb";

const abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "struct ReserveDataLegacy { uint256 configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }",
  "function getReserveData(address asset) view returns (ReserveDataLegacy)"
]);
const ZERO = "0x0000000000000000000000000000000000000000";

/** The Aave receipt token the fake reports for an underlying asset. Tests set its balance to give an Aave deposit. */
export const aTokenFor = (underlying) => `0xa7a7${underlying.toLowerCase().slice(6)}`;
/** Sky savings shares convert to assets at 1.05. */
export const SKY_RATE = [105n, 100n];

const initialState = () => ({
  users: {},
  // balances[chainId][token or "native"][owner] = raw amount as a decimal string
  balances: { 1: {}, 8453: {} },
  prices: { eth: "2500", btc: "60000" },
  // Names of edges that fail: "rpc:1", "rpc:8453", "kraken", "privy".
  down: []
});

export function startFakeEdge({ port }) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const verificationKey = publicKey.export({ type: "spki", format: "pem" }).toString();
  let state = initialState();

  const base64url = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value)).toString("base64url");
  function accessToken(userId, { expiresIn = 3600 } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const input = `${base64url({ alg: "ES256", typ: "JWT" })}.${base64url({ sid: randomUUID(), sub: userId, iss: "privy.io", aud: APP_ID, iat: now, exp: now + expiresIn })}`;
    const signature = sign("sha256", Buffer.from(input), { key: createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" })), dsaEncoding: "ieee-p1363" });
    return `${input}.${signature.toString("base64url")}`;
  }

  function privyUser(id) {
    const user = state.users[id];
    if (!user) return null;
    return {
      id, created_at: 1758844800, has_accepted_terms: true, is_guest: false,
      mfa_methods: (user.mfa ?? []).map((type) => ({ type, verified_at: 1758844800 })),
      linked_accounts: [
        ...(user.email ? [{ type: "email", address: user.email, verified_at: 1758844800, first_verified_at: 1758844800, latest_verified_at: 1758844800 }] : []),
        { type: "wallet", id: `wallet-${id}`, address: user.wallet, chain_type: "ethereum", wallet_client_type: "privy", connector_type: "embedded",
          wallet_index: 0, imported: false, delegated: false, verified_at: 1758844800, first_verified_at: 1758844800, latest_verified_at: 1758844800 },
        ...(user.externalWallets ?? []).map((address) => ({ type: "wallet", address, chain_type: "ethereum", wallet_client_type: "metamask",
          connector_type: "injected", verified_at: 1758844800, first_verified_at: 1758844800, latest_verified_at: 1758844800 }))
      ]
    };
  }

  const balance = (chainId, token, owner) => BigInt(state.balances[chainId]?.[token.toLowerCase()]?.[owner.toLowerCase()] ?? "0");

  function ethCall(chainId, { to, data }) {
    const { functionName, args } = decodeFunctionData({ abi, data });
    if (functionName === "balanceOf") return encodeFunctionResult({ abi, functionName, result: balance(chainId, to, args[0]) });
    if (functionName === "convertToAssets") return encodeFunctionResult({ abi, functionName, result: args[0] * SKY_RATE[0] / SKY_RATE[1] });
    if (functionName === "getReserveData") return encodeFunctionResult({ abi, functionName, result: {
      configuration: 0n, liquidityIndex: 0n, currentLiquidityRate: 0n, variableBorrowIndex: 0n, currentVariableBorrowRate: 0n, currentStableBorrowRate: 0n,
      lastUpdateTimestamp: 0, id: 0, aTokenAddress: aTokenFor(args[0]), stableDebtTokenAddress: ZERO, variableDebtTokenAddress: ZERO,
      interestRateStrategyAddress: ZERO, accruedToTreasury: 0n, unbacked: 0n, isolationModeTotalDebt: 0n } });
    throw new Error(`unsupported call ${functionName}`);
  }

  function rpc(chainId, request) {
    const { id, method, params } = request;
    const result = (value) => ({ jsonrpc: "2.0", id, result: value });
    if (method === "eth_chainId") return result(`0x${chainId.toString(16)}`);
    if (method === "eth_blockNumber") return result("0x1000");
    if (method === "eth_getBalance") return result(`0x${balance(chainId, "native", params[0]).toString(16)}`);
    if (method === "eth_call") {
      try { return result(ethCall(chainId, params[0])); }
      // Like a real node: a call it can't serve reverts, without internal details.
      catch { return { jsonrpc: "2.0", id, error: { code: -32000, message: "execution reverted" } }; }
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `method ${method} not supported by the fake node` } };
  }

  function kraken(url) {
    const pair = url.searchParams.get("pair");
    const asset = pair === "XBTUSD" ? "btc" : "eth";
    const price = state.prices?.[asset];
    if (!price) return { error: ["EService:Unavailable"] };
    const key = asset === "btc" ? "XXBTZUSD" : "XETHZUSD";
    const time = Math.floor(Date.now() / 1000) - 30;
    return { error: [], result: { [key]: [[time, price, price, price, price, price, "1", 1]], last: time } };
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const send = (status, payload) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
    const down = (name) => state.down.includes(name);

    // Test controls.
    if (url.pathname === "/__reset") { state = initialState(); return send(200, { ok: true }); }
    if (url.pathname === "/__state") { state = { ...state, ...body, balances: { ...state.balances, ...body?.balances } }; return send(200, { ok: true }); }
    if (url.pathname === "/__session") return send(200, { token: accessToken(body.userId, body) });

    // Privy's REST API.
    const user = /^\/privy\/v1\/users\/([^/]+)$/.exec(url.pathname);
    if (user) {
      if (down("privy")) return send(503, { error: "unavailable" });
      const found = privyUser(decodeURIComponent(user[1]));
      return found ? send(200, found) : send(404, { error: "User not found" });
    }

    // JSON-RPC nodes.
    const node = /^\/rpc\/(\d+)$/.exec(url.pathname);
    if (node) {
      const chainId = Number(node[1]);
      if (down(`rpc:${chainId}`)) return send(503, { error: "unavailable" });
      return send(200, Array.isArray(body) ? body.map((item) => rpc(chainId, item)) : rpc(chainId, body));
    }

    // Kraken.
    if (url.pathname === "/kraken/0/public/OHLC") return down("kraken") ? send(503, { error: ["EService:Unavailable"] }) : send(200, kraken(url));

    send(404, { error: `no fake for ${url.pathname}` });
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({
    verificationKey,
    secret: "e2e-fake-secret",
    vars: {
      PRIVY_API_URL: `http://127.0.0.1:${port}/privy`,
      PRIVY_VERIFICATION_KEY: verificationKey,
      RPC_URL_1: `http://127.0.0.1:${port}/rpc/1`,
      RPC_URL_8453: `http://127.0.0.1:${port}/rpc/8453`,
      KRAKEN_API_URL: `http://127.0.0.1:${port}/kraken`
    },
    close: () => new Promise((done) => server.close(done))
  })));
}
