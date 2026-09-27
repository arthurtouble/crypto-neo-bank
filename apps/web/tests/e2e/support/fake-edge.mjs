// A local stand-in for everything outside Aura that end-to-end tests touch:
// Privy's API and its access tokens, a JSON-RPC node for every supported
// chain, LI.FI, and the Kraken price feed. Aura's own server code and local D1
// run for real against it. Tests change what it returns through /__state and
// mint sessions through /__session. The browser's connected wallet (a fake
// MetaMask) sends through /__wallet/send, which moves balances like a chain.

import { createServer } from "node:http";
import { createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, parseAbi, parseAbiItem } from "viem";

/** The Privy user who may use the operations API in tests (feature switches). */
export const OPERATOR = { userId: "did:privy:e2e-operator", wallet: "0x00000000000000000000000000000000000e2e01" };
/** Where Privy's sponsored operations land: EntryPoint v0.7, called by a bundler. */
export const ENTRY_POINT = "0x0000000071727de22e5e9d8baf0edac6f37da032";
const BUNDLER = "0x000000000000000000000000000000000000b0b0";
const PAYMASTER = "0x000000000000000000000000000000000000fee0";
const entryPointAbi = parseAbi([
  "struct PackedUserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees; bytes paymasterAndData; bytes signature; }",
  "function handleOps(PackedUserOperation[] ops, address beneficiary)"
]);
const kernelAbi = parseAbi(["function execute(bytes32 mode, bytes executionCalldata)"]);
const beforeExecution = parseAbiItem("event BeforeExecution()");
const userOperationEvent = parseAbiItem("event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)");
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const aaveSupplyEvent = parseAbiItem("event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)");
const aaveWithdrawEvent = parseAbiItem("event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)");
const vaultDepositEvent = parseAbiItem("event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)");
const vaultWithdrawEvent = parseAbiItem("event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)");
const eventLog = (address, event, args, data) => ({ address, topics: encodeEventTopics({ abi: [event], eventName: event.name, args }),
  data: encodeAbiParameters(data.map(([type]) => ({ type })), data.map(([, value]) => value)) });

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
  // Aave's pool and ERC-4626 vaults.
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)",
  "function asset() view returns (address)",
  "function previewWithdraw(uint256 assets) view returns (uint256)",
  "function receiveSharesGate() view returns (address)",
  "function sendSharesGate() view returns (address)",
  "function receiveAssetsGate() view returns (address)",
  "function sendAssetsGate() view returns (address)",
  "function approve(address spender, uint256 amount) returns (bool)",
  // Multicall3, which wagmi uses to batch reads.
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
  "function getEthBalance(address addr) view returns (uint256 balance)",
  // Chainlink price feeds.
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
]);

/** Token decimals the fake's LI.FI echoes back, as LI.FI reports them. Anything else is a 6-decimal stablecoin. */
const DECIMALS = { "0xb200000000000000000000c2e324d24d7eecd1fb": 8, "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": 8,
  "0x4200000000000000000000000000000000000006": 18 };

/** Chainlink feeds on Base the fake answers, with 8 decimals: Apple, gold (XAU/USD), and the euro. */
export const FEEDS = { apple: "0x787f13dea48db0897cbcdd985de77809d837f988", gold: "0x5213ebb69743b85644dbb6e25cdf994afbb8cf31", euro: "0xc91d87e81fab8f93699ecf7ee9b44d11e1d53f0f" };
const ZERO = "0x0000000000000000000000000000000000000000";

/** The Aave receipt token the fake reports for an underlying asset. Tests set its balance to give an Aave deposit. */
export const aTokenFor = (underlying) => `0xa7a7${underlying.toLowerCase().slice(6)}`;
/** Aave's Base pool, and the Morpho USDC vaults Aura offers. Vault shares (18 decimals) redeem for 1.05 USDC (6 decimals) each. */
export const AAVE_POOL = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";
export const VAULTS = { steakhouse: "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9", gauntlet: "0xee8f4ec5672f09119b96ab6fb59c27e1b7e44b61" };
const VAULT_SET = new Set(Object.values(VAULTS));
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const sharesToAssets = (shares) => shares * 105n / 100n / 10n ** 12n;
const assetsToShares = (assets) => (assets * 10n ** 12n * 100n + 104n) / 105n;

const initialState = () => ({
  users: { [OPERATOR.userId]: { wallet: OPERATOR.wallet } },
  // balances[chainId][token or "native"][owner] = raw amount as a decimal string
  balances: {},
  prices: { eth: "2500", btc: "60000" },
  // Chainlink answers (dollars) and when they were published, in seconds ago. A feed not listed reverts.
  feeds: { [FEEDS.apple]: "341.51", [FEEDS.gold]: "4285.62", [FEEDS.euro]: "1.14" },
  feedAgeSeconds: 3600,
  // Names of edges that fail: "rpc:<chainId>", "kraken", "privy", "lifi".
  down: [],
  // The next transaction a connected wallet sends reverts on chain.
  revertNext: false,
  // The chain: every transaction gets its own block. With finalizeAll off, nothing is final yet ("sent", not "complete").
  head: 4096,
  finalizeAll: true,
  txs: {},
  // Privy's relay: "ok", "reject" (Privy refuses, 400), "error" (Privy fails, 500), or "revert" (the operation lands but reverts).
  relay: "ok",
  relayed: {},
  // What LI.FI reports for a bridge: PENDING, or DONE with substatus COMPLETED or REFUNDED.
  bridge: { status: "PENDING", substatus: null },
  // LI.FI quotes: "ok", "no_route" (404), or "impact" (dollar values showing 10% lost). `lifiUsd` sets the dollar values;
  // `swapShortfall` makes a same-network swap pay out 95% of the minimum, which the verifier must catch.
  lifiQuote: "ok",
  lifiUsd: null,
  swapShortfall: false,
  // The latest quote, and the delivery each bridged transaction got once LI.FI reported it done.
  lastQuote: null,
  deliveries: {},
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

  const blockHash = (number) => `0x${number.toString(16).padStart(64, "0")}`;

  /** Put a transaction in the next block. */
  function mine(tx) {
    const hash = `0x${randomBytes(32).toString("hex")}`;
    state.head += 1;
    state.txs[hash] = { ...tx, from: tx.from.toLowerCase(), to: tx.to.toLowerCase(), blockNumber: state.head };
    // When everything is final, the chain has moved on: enough blocks for any network's confirmations (Ethereum needs 12).
    if (state.finalizeAll) state.head += 64;
    return hash;
  }

  /** The balance changes and Transfer logs of one call, applied only if every call in the batch can succeed. */
  function effectsOf(chainId, from, calls) {
    const moves = [];
    for (const call of calls) {
      const value = BigInt(call.value ?? "0x0");
      const data = call.data ?? "0x";
      if (data === "0x") { moves.push({ token: "native", to: call.to, amount: value }); continue; }
      if (call.to.toLowerCase() === LIFI_DIAMOND) {
        // A route: the Diamond takes the ETH sent, or the tokens approved earlier in the batch. LI.FI reports delivery later.
        const approved = moves.findLast((item) => item.approve);
        moves.push(value > 0n ? { token: "native", to: LIFI_DIAMOND, amount: value } : { token: approved.token, to: LIFI_DIAMOND, amount: approved.amount });
        // A swap on the same network pays out in the same operation; a bridge pays out later on the other network.
        const quote = state.lastQuote;
        if (quote && quote.toChain === chainId) moves.push({ mint: true, token: quote.toToken ?? "native", to: quote.toAddress, amount: quote.toAmount });
        continue;
      }
      const { functionName, args } = decodeFunctionData({ abi, data });
      const to = call.to.toLowerCase();
      if (functionName === "transfer") moves.push({ token: call.to, to: args[0], amount: args[1] });
      else if (functionName === "approve") moves.push({ approve: true, token: call.to, amount: args[1] });
      else if (to === AAVE_POOL && functionName === "supply") {
        // Aave: the asset goes to the pool, the account gets aTokens one for one.
        const [asset, amount, onBehalfOf] = args;
        moves.push({ token: asset, to: AAVE_POOL, amount }, { mint: true, token: aTokenFor(asset), to: onBehalfOf.toLowerCase(), amount, from: ZERO },
          { log: eventLog(AAVE_POOL, aaveSupplyEvent, { reserve: asset, onBehalfOf, referralCode: 0 }, [["address", from], ["uint256", amount]]) });
      } else if (to === AAVE_POOL && functionName === "withdraw") {
        const [asset, amount, receiver] = args;
        moves.push({ burn: true, token: aTokenFor(asset), amount }, { mint: true, token: asset, to: receiver.toLowerCase(), amount, from: AAVE_POOL },
          { log: eventLog(AAVE_POOL, aaveWithdrawEvent, { reserve: asset, user: from, to: receiver }, [["uint256", amount]]) });
      } else if (VAULT_SET.has(to) && functionName === "deposit") {
        // A Morpho vault: USDC in, shares out at the vault's rate.
        const [assets, receiver] = args;
        const shares = assets * 10n ** 12n * 100n / 105n;
        moves.push({ token: USDC_BASE, to, amount: assets }, { mint: true, token: to, to: receiver.toLowerCase(), amount: shares, from: ZERO },
          { log: eventLog(to, vaultDepositEvent, { sender: from, owner: receiver }, [["uint256", assets], ["uint256", shares]]) });
      } else if (VAULT_SET.has(to) && (functionName === "withdraw" || functionName === "redeem")) {
        const [amount, receiver, owner] = args;
        const [assets, shares] = functionName === "withdraw" ? [amount, assetsToShares(amount)] : [sharesToAssets(amount), amount];
        if (state.vaultIlliquid) throw new Error("not enough liquidity");
        moves.push({ burn: true, token: to, amount: shares }, { mint: true, token: USDC_BASE, to: receiver.toLowerCase(), amount: assets, from: to },
          { log: eventLog(to, vaultWithdrawEvent, { sender: from, receiver, owner }, [["uint256", assets], ["uint256", shares]]) });
      }
      else throw new Error(`unsupported ${functionName}`);
    }
    const needed = new Map();
    for (const move of moves) if (!move.approve && !move.mint && !move.log) needed.set(move.token.toLowerCase(), (needed.get(move.token.toLowerCase()) ?? 0n) + move.amount);
    for (const [token, amount] of needed) if (balance(chainId, token, from) < amount) throw new Error("insufficient balance");
    return moves;
  }

  function apply(chainId, from, moves) {
    const logs = [];
    for (const item of moves) {
      if (item.approve) { state.approvals[`${chainId}:${from.toLowerCase()}`] = { token: item.token.toLowerCase(), amount: item.amount }; continue; }
      if (item.log) { logs.push(item.log); continue; }
      if (item.burn) {
        const key = item.token.toLowerCase();
        state.balances[chainId][key][from.toLowerCase()] = (balance(chainId, key, from) - item.amount).toString();
        logs.push({ address: key, topics: encodeEventTopics({ abi: [transferEvent], eventName: "Transfer", args: { from, to: ZERO } }), data: encodeAbiParameters([{ type: "uint256" }], [item.amount]) });
        continue;
      }
      if (item.mint) {
        // The Diamond pays the swap's output from its own liquidity.
        const key = item.token.toLowerCase();
        state.balances[chainId] ??= {}; state.balances[chainId][key] ??= {};
        state.balances[chainId][key][item.to] = (balance(chainId, key, item.to) + item.amount).toString();
        if (item.token !== "native") logs.push({ address: key, topics: encodeEventTopics({ abi: [transferEvent], eventName: "Transfer", args: { from: item.from ?? LIFI_DIAMOND, to: item.to } }),
          data: encodeAbiParameters([{ type: "uint256" }], [item.amount]) });
        continue;
      }
      move(chainId, item.token, from, item.to, item.amount);
      if (item.token !== "native") logs.push({ address: item.token.toLowerCase(), topics: encodeEventTopics({ abi: [transferEvent], eventName: "Transfer", args: { from, to: item.to } }),
        data: encodeAbiParameters([{ type: "uint256" }], [item.amount]) });
    }
    return logs;
  }

  /** A connected wallet's own transaction: apply its effect like the chain would, and keep a receipt. */
  function sendTransaction({ chainId, from, to, data = "0x", value = "0x0" }) {
    const amount = BigInt(value);
    let success = !state.revertNext;
    state.revertNext = false;
    let logs = [];
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
        } else logs = apply(chainId, from, effectsOf(chainId, from, [{ to, data, value }]));
      } catch { success = false; }
    }
    const hash = mine({ chainId, from, to, value: `0x${amount.toString(16)}`, input: data, success, logs });
    state.sent.push({ hash, chainId, from: from.toLowerCase(), to: to.toLowerCase(), data, value: amount.toString(), success });
    return hash;
  }

  /**
   * Privy's sponsored wallet_sendCalls: a bundler submits EntryPoint.handleOps
   * with one operation from the customer's account, a Kernel batch of their
   * calls. The operation's logs sit between BeforeExecution and its
   * UserOperationEvent, as on chain.
   */
  function relay(wallet, chainId, calls) {
    let success = state.relay !== "revert";
    let execution = [];
    try { if (success) execution = apply(chainId, wallet, effectsOf(chainId, wallet, calls)); }
    catch { success = false; }
    const batch = encodeAbiParameters([{ type: "tuple[]", components: [{ name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
      [calls.map((call) => ({ target: call.to, value: BigInt(call.value ?? "0x0"), callData: call.data ?? "0x" }))]);
    const callData = encodeFunctionData({ abi: kernelAbi, functionName: "execute", args: [`0x01${"00".repeat(31)}`, batch] });
    const zero = `0x${"00".repeat(32)}`;
    const input = encodeFunctionData({ abi: entryPointAbi, functionName: "handleOps", args: [[{ sender: wallet, nonce: 0n, initCode: "0x", callData,
      accountGasLimits: zero, preVerificationGas: 0n, gasFees: zero, paymasterAndData: "0x", signature: "0x" }], BUNDLER] });
    const logs = [
      { address: ENTRY_POINT, topics: encodeEventTopics({ abi: [beforeExecution], eventName: "BeforeExecution" }), data: "0x" },
      ...execution,
      { address: ENTRY_POINT, topics: encodeEventTopics({ abi: [userOperationEvent], eventName: "UserOperationEvent", args: { userOpHash: `0x${randomBytes(32).toString("hex")}`, sender: wallet, paymaster: PAYMASTER } }),
        data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [0n, success, 0n, 0n]) }
    ];
    const hash = mine({ chainId, from: BUNDLER, to: ENTRY_POINT, value: "0x0", input, success: true, logs });
    state.sent.push({ hash, chainId, from: wallet.toLowerCase(), to: ENTRY_POINT, data: input, value: "0", success, relayed: true, calls });
    return hash;
  }

  function receipt(hash) {
    const tx = state.txs[hash];
    if (!tx) return null;
    return { transactionHash: hash, transactionIndex: "0x0", blockHash: blockHash(tx.blockNumber), blockNumber: `0x${tx.blockNumber.toString(16)}`, from: tx.from, to: tx.to,
      cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x1", contractAddress: null,
      logs: tx.logs.map((log, index) => ({ ...log, blockNumber: `0x${tx.blockNumber.toString(16)}`, blockHash: blockHash(tx.blockNumber), transactionHash: hash,
        transactionIndex: "0x0", logIndex: `0x${index.toString(16)}`, removed: false })),
      logsBloom: `0x${"0".repeat(512)}`, status: tx.success ? "0x1" : "0x0", type: "0x2" };
  }

  function block(tag) {
    const number = tag === "latest" ? state.head : tag === "finalized" ? (state.finalizeAll ? state.head : 0) : Number.parseInt(tag, 16);
    return { number: `0x${number.toString(16)}`, hash: blockHash(number), parentHash: blockHash(Math.max(0, number - 1)), timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, transactions: [] };
  }

  function ethCall(chainId, { to, data }) {
    const { functionName, args } = decodeFunctionData({ abi, data });
    if (functionName === "getEthBalance") return encodeFunctionResult({ abi, functionName, result: balance(chainId, "native", args[0]) });
    if (functionName === "balanceOf") return encodeFunctionResult({ abi, functionName, result: balance(chainId, to, args[0]) });
    if (functionName === "latestRoundData") {
      const usd = state.feeds[to.toLowerCase()];
      if (!usd) throw new Error("no feed");
      const [whole, fraction = ""] = usd.split(".");
      const updatedAt = BigInt(Math.floor(Date.now() / 1000) - state.feedAgeSeconds);
      return encodeFunctionResult({ abi, functionName, result: [1n, BigInt(whole + fraction.padEnd(8, "0").slice(0, 8)), updatedAt, updatedAt, 1n] });
    }
    if (functionName === "convertToAssets") return encodeFunctionResult({ abi, functionName, result: sharesToAssets(args[0]) });
    if (functionName === "previewWithdraw") return encodeFunctionResult({ abi, functionName, result: assetsToShares(args[0]) });
    if (functionName === "asset") return encodeFunctionResult({ abi, functionName, result: USDC_BASE });
    if (functionName.endsWith("Gate")) return encodeFunctionResult({ abi, functionName, result: state.vaultGate ?? ZERO });
    if (functionName === "aggregate3") return encodeFunctionResult({ abi, functionName, result: args[0].map((call) => {
      try { return { success: true, returnData: ethCall(chainId, { to: call.target, data: call.callData }) }; }
      catch { return { success: false, returnData: "0x" }; }
    }) });
    if (functionName === "getReserveData") return encodeFunctionResult({ abi, functionName, result: {
      configuration: 0n, liquidityIndex: 0n, currentLiquidityRate: 37_777_000_000_000_000_000_000_000n, variableBorrowIndex: 0n, currentVariableBorrowRate: 0n, currentStableBorrowRate: 0n,
      lastUpdateTimestamp: 0, id: 0, aTokenAddress: aTokenFor(args[0]), stableDebtTokenAddress: ZERO, variableDebtTokenAddress: ZERO,
      interestRateStrategyAddress: ZERO, accruedToTreasury: 0n, unbacked: 0n, isolationModeTotalDebt: 0n } });
    throw new Error(`unsupported call ${functionName}`);
  }

  function rpc(chainId, request) {
    const { id, method, params } = request;
    const result = (value) => ({ jsonrpc: "2.0", id, result: value });
    if (method === "eth_chainId") return result(`0x${chainId.toString(16)}`);
    if (method === "eth_blockNumber") return result(`0x${state.head.toString(16)}`);
    if (method === "eth_getBlockByNumber") return result(block(params[0]));
    if (method === "eth_getBalance") return result(`0x${balance(chainId, "native", params[0]).toString(16)}`);
    if (method === "eth_getTransactionReceipt") return result(receipt(params[0]));
    if (method === "eth_getTransactionByHash") {
      const tx = state.txs[params[0]];
      return result(tx ? { hash: params[0], from: tx.from, to: tx.to, blockHash: blockHash(tx.blockNumber), blockNumber: `0x${tx.blockNumber.toString(16)}`,
        transactionIndex: "0x0", nonce: "0x0", value: tx.value, input: tx.input, gas: "0x5208", gasPrice: "0x1", type: "0x0", chainId: `0x${chainId.toString(16)}`,
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
    const tokenOf = (address, chainId) => /^0x0{40}$/i.test(address) ? { address, chainId, decimals: 18, symbol: "ETH" }
      : { address, chainId, decimals: DECIMALS[address.toLowerCase()] ?? 6, symbol: "TOKEN" };
    const fromAmount = BigInt(q.fromAmount);
    // A same-asset quote keeps 99.5% (99% minimum); a swap to another asset pays out one unit of it per unit paid, scaled by decimals.
    const scale = (tokenOf(q.toToken, 0).decimals - tokenOf(q.fromToken, 0).decimals);
    const converted = scale >= 0 ? fromAmount * 10n ** BigInt(scale) : fromAmount / 10n ** BigInt(-scale);
    const toAmount = converted * 995n / 1000n;
    const toMin = converted * 990n / 1000n;
    const toNative = /^0x0{40}$/i.test(q.toToken);
    state.lastQuote = { fromChain: Number(q.fromChain), toChain: Number(q.toChain), toToken: toNative ? null : q.toToken.toLowerCase(), toAddress: q.toAddress.toLowerCase(),
      toAmount: state.swapShortfall ? toMin * 95n / 100n : toAmount };
    const usd = state.lifiQuote === "impact" ? { fromAmountUSD: "10.00", toAmountUSD: "9.00" } : state.lifiUsd ?? {};
    return {
      id: randomUUID(), tool: "across",
      action: { fromChainId: Number(q.fromChain), toChainId: Number(q.toChain), fromToken: tokenOf(q.fromToken, Number(q.fromChain)),
        toToken: tokenOf(q.toToken, Number(q.toChain)), fromAmount: q.fromAmount, fromAddress: q.fromAddress, toAddress: q.toAddress, slippage: Number(q.slippage) },
      estimate: { fromAmount: q.fromAmount, toAmount: toAmount.toString(), toAmountMin: toMin.toString(), ...usd,
        approvalAddress: LIFI_DIAMOND, gasCosts: [{ amountUSD: "0.10" }], feeCosts: [{ amountUSD: "0.50" }] },
      transactionRequest: { to: LIFI_DIAMOND, data: "0x4630a0d8" + "00".repeat(32), value: native ? `0x${fromAmount.toString(16)}` : "0x0",
        chainId: Number(q.fromChain), from: q.fromAddress }
    };
  }

  function lifiStatus(url) {
    const q = Object.fromEntries(url.searchParams);
    const { status, substatus } = state.bridge;
    const delivered = status === "DONE" && substatus !== "REFUNDED";
    return { status, substatus: substatus ?? undefined, tool: q.bridge, sending: { txHash: q.txHash, chainId: Number(q.fromChain) },
      receiving: delivered ? { txHash: deliver(q.txHash), chainId: Number(q.toChain) } : undefined };
  }

  /** The bridge's payout on the destination network, mined once per source transaction: the quoted amount to the recipient. */
  function deliver(sourceHash) {
    if (state.deliveries[sourceHash]) return state.deliveries[sourceHash];
    const quote = state.lastQuote;
    if (!quote) return (state.deliveries[sourceHash] = `0x${"d".repeat(64)}`);
    const token = quote.toToken ?? "native";
    state.balances[quote.toChain] ??= {};
    state.balances[quote.toChain][token] ??= {};
    state.balances[quote.toChain][token][quote.toAddress] = (balance(quote.toChain, token, quote.toAddress) + quote.toAmount).toString();
    const logs = quote.toToken ? [{ address: quote.toToken, topics: encodeEventTopics({ abi: [transferEvent], eventName: "Transfer", args: { from: LIFI_DIAMOND, to: quote.toAddress } }),
      data: encodeAbiParameters([{ type: "uint256" }], [quote.toAmount]) }] : [];
    state.deliveries[sourceHash] = mine({ chainId: quote.toChain, from: LIFI_DIAMOND, to: quote.toToken ?? quote.toAddress,
      value: quote.toToken ? "0x0" : `0x${quote.toAmount.toString(16)}`, input: "0x", success: true, logs });
    // The destination keeps producing blocks, so the payout gathers the confirmations it needs (64 on Polygon).
    state.head += 64;
    return state.deliveries[sourceHash];
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
    if (url.pathname === "/__state") { state = { ...state, ...body, users: { ...state.users, ...body?.users }, balances: { ...state.balances, ...body?.balances } }; return send(200, { ok: true }); }
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

    // Privy's wallet relay: wallet_sendCalls from the customer's embedded wallet, sponsored.
    const walletRpc = /^\/privy\/v1\/wallets\/([^/]+)\/rpc$/.exec(url.pathname);
    if (walletRpc) {
      const walletId = decodeURIComponent(walletRpc[1]);
      const owner = Object.entries(state.users).find(([id]) => `wallet-${id}` === walletId);
      if (!owner || body?.method !== "wallet_sendCalls") return send(404, { error: "wallet not found" });
      if (state.relay === "reject") return send(400, { error: "Invalid authorization signature" });
      if (state.relay === "error") return send(500, { error: "internal error" });
      const key = req.headers["privy-idempotency-key"];
      // The same signed request is never sent twice.
      if (key && state.relayed[key]) return send(200, { method: "wallet_sendCalls", data: { transaction_id: state.relayed[key].id } });
      const chainId = Number(String(body.caip2).split(":")[1]);
      const id = randomUUID();
      const hash = relay(owner[1].wallet, chainId, body.params.calls);
      state.relayed[key ?? id] = { id, hash };
      return send(200, { method: "wallet_sendCalls", data: { transaction_id: id } });
    }
    const relayed = /^\/privy\/v1\/transactions\/([^/]+)$/.exec(url.pathname);
    if (relayed) {
      const found = Object.values(state.relayed).find((item) => item.id === decodeURIComponent(relayed[1]));
      return found ? send(200, { id: found.id, status: "confirmed", transaction_hash: found.hash, caip2: "eip155:8453", created_at: Date.now() })
        : send(404, { error: "transaction not found" });
    }

    // JSON-RPC nodes.
    const node = /^\/rpc\/(\d+)$/.exec(url.pathname);
    if (node) {
      const chainId = Number(node[1]);
      if (down(`rpc:${chainId}`)) return send(503, { error: "unavailable" });
      return send(200, Array.isArray(body) ? body.map((item) => rpc(chainId, item)) : rpc(chainId, body));
    }

    // LI.FI.
    // Aave's data service (an MCP tool call) and Morpho's GraphQL API: rates, deposits, and liquidity. "aave" and "morpho" in `down` make them fail.
    if (url.pathname === "/aave") return down("aave") ? send(503, { error: "unavailable" }) : send(200, { jsonrpc: "2.0", id: body?.id, result: { structuredContent: { data: { v3: { markets: [{
      market: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", chainId: 8453, name: "AaveV3Base", reserves: [
        { symbol: "USDC", underlyingToken: USDC_BASE, supplyApyPct: "3.85", borrowApyPct: "5.10", totalSuppliedUsd: "310000000", canSupply: true, canBorrow: true, availableLiquidity: { value: "90000000", usd: "90000000" } },
        { symbol: "WETH", underlyingToken: "0x4200000000000000000000000000000000000006", supplyApyPct: "1.95", borrowApyPct: "2.60", totalSuppliedUsd: "420000000", canSupply: true, canBorrow: true, availableLiquidity: { value: "40000", usd: "100000000" } }
      ] }] } } } } });
    if (url.pathname === "/morpho") return down("morpho") ? send(503, { errors: [{ message: "unavailable" }] }) : send(200, { data: {
      steakhouse_prime_usdc: { netApy: 0.0441, totalAssetsUsd: 444_000_000, liquidityUsd: 163_000_000 },
      gauntlet_usdc_prime: { state: { netApy: 0.0438, totalAssetsUsd: 415_000_000 }, liquidity: { usd: 175_000_000 } } } });
    if (url.pathname === "/lifi/v1/quote") return down("lifi") ? send(503, { message: "unavailable" })
      : state.lifiQuote === "no_route" ? send(404, { message: "No available quotes for the requested transfer" }) : send(200, lifiQuote(url));
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
      AAVE_API_URL: `http://127.0.0.1:${port}/aave`,
      MORPHO_API_URL: `http://127.0.0.1:${port}/morpho`,
      RPC_URL_10: `http://127.0.0.1:${port}/rpc/10`,
      RPC_URL_137: `http://127.0.0.1:${port}/rpc/137`,
      RPC_URL_42161: `http://127.0.0.1:${port}/rpc/42161`,
      ADMIN_PRIVY_SUBJECTS: OPERATOR.userId
    },
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(done))
  })));
}
