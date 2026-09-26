// A local stand-in for everything outside Aura that end-to-end tests touch:
// Privy's API and its access tokens, a JSON-RPC node for every supported
// chain, LI.FI, and the Kraken price feed. Aura's own server code and local D1
// run for real against it. Tests change what it returns through /__state and
// mint sessions through /__session. The browser's connected wallet (a fake
// MetaMask) sends through /__wallet/send, which moves balances like a chain.

import { createServer } from "node:http";
import { createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";

/** The Privy user who may use the operations API in tests (feature switches). */
export const OPERATOR = { userId: "did:privy:e2e-operator", wallet: "0x00000000000000000000000000000000000e2e01" };
/** LI.FI's Diamond, the only contract a bridge quote may call. */
export const LIFI_DIAMOND = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";

// The public app ID the web app is built with (src/config/client.ts).
export const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "cmub5evr4013l0cjs0w5dijlb";

const abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "struct ReserveDataLegacy { uint256 configuration; uint128 liquidityIndex; uint128 currentLiquidityRate; uint128 variableBorrowIndex; uint128 currentVariableBorrowRate; uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id; address aTokenAddress; address stableDebtTokenAddress; address variableDebtTokenAddress; address interestRateStrategyAddress; uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt; }",
  "function getReserveData(address asset) view returns (ReserveDataLegacy)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  // Multicall3, which wagmi uses to batch reads.
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
  "function getEthBalance(address addr) view returns (uint256 balance)"
]);
const ZERO = "0x0000000000000000000000000000000000000000";

/** The Aave receipt token the fake reports for an underlying asset. Tests set its balance to give an Aave deposit. */
export const aTokenFor = (underlying) => `0xa7a7${underlying.toLowerCase().slice(6)}`;
/** Sky savings shares convert to assets at 1.05. */
export const SKY_RATE = [105n, 100n];

const initialState = () => ({
  users: { [OPERATOR.userId]: { wallet: OPERATOR.wallet } },
  // balances[chainId][token or "native"][owner] = raw amount as a decimal string
  balances: {},
  prices: { eth: "2500", btc: "60000" },
  // Names of edges that fail: "rpc:<chainId>", "kraken", "privy", "lifi".
  down: [],
  // The next transaction a connected wallet sends reverts on chain.
  revertNext: false,
  // What LI.FI reports for a bridge: PENDING, or DONE with substatus COMPLETED or REFUNDED.
  bridge: { status: "PENDING", substatus: null },
  receipts: {},
  approvals: {},
  // Every transaction a connected wallet sent, for tests to inspect.
  sent: []
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
  function move(chainId, token, from, to, amount) {
    const key = token.toLowerCase();
    state.balances[chainId] ??= {};
    state.balances[chainId][key] ??= {};
    const book = state.balances[chainId][key];
    const available = balance(chainId, key, from);
    if (available < amount) throw new Error("insufficient balance");
    book[from.toLowerCase()] = (available - amount).toString();
    if (to) book[to.toLowerCase()] = (balance(chainId, key, to) + amount).toString();
  }

  /** A connected wallet's transaction: apply its effect like the chain would, and keep a receipt. */
  function sendTransaction({ chainId, from, to, data = "0x", value = "0x0" }) {
    const hash = `0x${randomBytes(32).toString("hex")}`;
    const amount = BigInt(value);
    let success = !state.revertNext;
    state.revertNext = false;
    if (success) {
      try {
        if (to.toLowerCase() === LIFI_DIAMOND) {
          // A bridge: the source asset leaves the wallet now; LI.FI reports delivery later.
          if (amount > 0n) move(chainId, "native", from, null, amount);
          else {
            const approval = state.approvals[`${chainId}:${from.toLowerCase()}`];
            if (!approval) throw new Error("no approval");
            move(chainId, approval.token, from, null, approval.amount);
          }
        } else if (data === "0x") move(chainId, "native", from, to, amount);
        else {
          const { functionName, args } = decodeFunctionData({ abi, data });
          if (functionName === "transfer") move(chainId, to, from, args[0], args[1]);
          else if (functionName === "approve") state.approvals[`${chainId}:${from.toLowerCase()}`] = { token: to.toLowerCase(), amount: args[1] };
          else throw new Error(`unsupported ${functionName}`);
        }
      } catch { success = false; }
    }
    state.receipts[hash] = { chainId, from: from.toLowerCase(), to: to.toLowerCase(), status: success ? "0x1" : "0x0" };
    state.sent.push({ hash, chainId, from: from.toLowerCase(), to: to.toLowerCase(), data, value: amount.toString(), success });
    return hash;
  }

  function receipt(hash) {
    const item = state.receipts[hash];
    if (!item) return null;
    const blockHash = `0x${"b".repeat(64)}`;
    return { transactionHash: hash, transactionIndex: "0x0", blockHash, blockNumber: "0x1000", from: item.from, to: item.to,
      cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x1", contractAddress: null, logs: [],
      logsBloom: `0x${"0".repeat(512)}`, status: item.status, type: "0x2" };
  }

  function ethCall(chainId, { to, data }) {
    const { functionName, args } = decodeFunctionData({ abi, data });
    if (functionName === "getEthBalance") return encodeFunctionResult({ abi, functionName, result: balance(chainId, "native", args[0]) });
    if (functionName === "balanceOf") return encodeFunctionResult({ abi, functionName, result: balance(chainId, to, args[0]) });
    if (functionName === "convertToAssets") return encodeFunctionResult({ abi, functionName, result: args[0] * SKY_RATE[0] / SKY_RATE[1] });
    if (functionName === "aggregate3") return encodeFunctionResult({ abi, functionName, result: args[0].map((call) => {
      try { return { success: true, returnData: ethCall(chainId, { to: call.target, data: call.callData }) }; }
      catch { return { success: false, returnData: "0x" }; }
    }) });
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
    if (method === "eth_getTransactionReceipt") return result(receipt(params[0]));
    if (method === "eth_getTransactionByHash") {
      const item = state.receipts[params[0]];
      return result(item ? { hash: params[0], from: item.from, to: item.to, blockHash: `0x${"b".repeat(64)}`, blockNumber: "0x1000",
        transactionIndex: "0x0", nonce: "0x0", value: "0x0", input: "0x", gas: "0x5208", gasPrice: "0x1", type: "0x0", chainId: `0x${chainId.toString(16)}`,
        v: "0x1b", r: `0x${"1".repeat(64)}`, s: `0x${"1".repeat(64)}` } : null);
    }
    if (method === "eth_call") {
      try { return result(ethCall(chainId, params[0])); }
      // Like a real node: a call it can't serve reverts, without internal details.
      catch { return { jsonrpc: "2.0", id, error: { code: -32000, message: "execution reverted" } }; }
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `method ${method} not supported by the fake node` } };
  }

  // LI.FI: a quote echoes the request as a same-asset bridge through the Diamond, keeping 99.5% (99% minimum).
  function lifiQuote(url) {
    const q = Object.fromEntries(url.searchParams);
    const native = /^0x0{40}$/i.test(q.fromToken);
    const tokenOf = (address, chainId) => native ? { address, chainId, decimals: 18, symbol: "ETH" } : { address, chainId, decimals: 6, symbol: "USDC" };
    const fromAmount = BigInt(q.fromAmount);
    return {
      id: randomUUID(), tool: "across",
      action: { fromChainId: Number(q.fromChain), toChainId: Number(q.toChain), fromToken: tokenOf(q.fromToken, Number(q.fromChain)),
        toToken: tokenOf(q.toToken, Number(q.toChain)), fromAmount: q.fromAmount, fromAddress: q.fromAddress, toAddress: q.toAddress, slippage: Number(q.slippage) },
      estimate: { fromAmount: q.fromAmount, toAmount: (fromAmount * 995n / 1000n).toString(), toAmountMin: (fromAmount * 990n / 1000n).toString(),
        approvalAddress: LIFI_DIAMOND, gasCosts: [{ amountUSD: "0.10" }], feeCosts: [{ amountUSD: "0.50" }] },
      transactionRequest: { to: LIFI_DIAMOND, data: "0x4630a0d8" + "00".repeat(32), value: native ? `0x${fromAmount.toString(16)}` : "0x0",
        chainId: Number(q.fromChain), from: q.fromAddress }
    };
  }

  function lifiStatus(url) {
    const q = Object.fromEntries(url.searchParams);
    const { status, substatus } = state.bridge;
    return { status, substatus: substatus ?? undefined, tool: q.bridge, sending: { txHash: q.txHash, chainId: Number(q.fromChain) },
      receiving: status === "DONE" && substatus !== "REFUNDED" ? { txHash: `0x${"d".repeat(64)}`, chainId: Number(q.toChain) } : undefined };
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
    // The browser's fake wallet and wagmi reads come from the app's origin.
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
    const send = (status, payload) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(payload)); };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const down = (name) => state.down.includes(name);

    // Test controls.
    if (url.pathname === "/__reset") { state = initialState(); return send(200, { ok: true }); }
    if (url.pathname === "/__state") { state = { ...state, ...body, balances: { ...state.balances, ...body?.balances } }; return send(200, { ok: true }); }
    if (url.pathname === "/__session") return send(200, { token: accessToken(body.userId, body) });
    if (url.pathname === "/__sent") return send(200, { sent: state.sent });
    if (url.pathname === "/__balances") {
      // Set individual balances without touching any other wallet's.
      for (const { chainId, token, owner, amount } of body) {
        state.balances[chainId] ??= {};
        state.balances[chainId][token.toLowerCase()] ??= {};
        state.balances[chainId][token.toLowerCase()][owner.toLowerCase()] = amount;
      }
      return send(200, { ok: true });
    }
    if (url.pathname === "/__wallet/send") {
      if (down(`rpc:${body.chainId}`)) return send(503, { error: "unavailable" });
      return send(200, { hash: sendTransaction(body) });
    }

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

    // LI.FI.
    if (url.pathname === "/lifi/v1/quote") return down("lifi") ? send(503, { message: "unavailable" }) : send(200, lifiQuote(url));
    if (url.pathname === "/lifi/v1/status") return down("lifi") ? send(503, { message: "unavailable" }) : send(200, lifiStatus(url));

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
      KRAKEN_API_URL: `http://127.0.0.1:${port}/kraken`,
      LIFI_API_URL: `http://127.0.0.1:${port}/lifi`,
      RPC_URL_10: `http://127.0.0.1:${port}/rpc/10`,
      RPC_URL_137: `http://127.0.0.1:${port}/rpc/137`,
      RPC_URL_42161: `http://127.0.0.1:${port}/rpc/42161`,
      ADMIN_PRIVY_SUBJECTS: OPERATOR.userId
    },
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(done))
  })));
}
