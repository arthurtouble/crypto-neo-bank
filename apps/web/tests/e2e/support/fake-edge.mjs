// A local stand-in for everything outside Aura that end-to-end tests touch:
// Privy's API and its access tokens, a JSON-RPC node for every supported
// chain, LI.FI, the Kraken price feed, Resend (email), and a browser push
// service. Aura's own server code and local D1
// run for real against it. Tests change what it returns through /__state and
// mint sessions through /__session. The browser's connected wallet (a fake
// MetaMask) sends through /__wallet/send, which moves balances like a chain.

import { createServer } from "node:http";
import { createPrivateKey, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, maxUint256, parseAbi, parseAbiItem } from "viem";

/** The Privy user who may use the operations API in tests (feature switches). */
/** The operator Cloudflare Access lets into the operations app in tests, and the ops app's Access audience. */
export const OPERATOR = { email: "operator@aura-e2e.test", audience: "aura-ops-e2e" };
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
const approvalEvent = parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)");
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
  "function allowance(address owner, address spender) view returns (uint256)",
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
/** Bridge: the address its USD account deliveries come from, and where a payout's USDC goes. */
export const BRIDGE = { sender: "0x00000000000000000000000000000000b41d6e01", payoutDeposit: "0x00000000000000000000000000000000b41d6e02",
  cardsSpender: "0x00000000000000000000000000000000b41d6e03" };
const sharesToAssets = (shares) => shares * 105n / 100n / 10n ** 12n;
const assetsToShares = (assets) => (assets * 10n ** 12n * 100n + 104n) / 105n;

const initialState = () => ({
  users: {},
  // balances[chainId][token or "native"][owner] = raw amount as a decimal string
  balances: {},
  prices: { eth: "2500", btc: "60000" },
  // Chainlink answers (dollars) and when they were published, in seconds ago. A feed not listed reverts.
  feeds: { [FEEDS.apple]: "341.51", [FEEDS.gold]: "4285.62", [FEEDS.euro]: "1.14" },
  feedAgeSeconds: 3600,
  // Emails sent through the fake Resend, and messages sent to the fake push service.
  emails: [],
  pushes: [],
  // Bridge: KYC links, customers' USD accounts and their deposit history, saved banks, and transfers.
  bridgeXyz: { kycLinks: {}, accounts: {}, history: {}, externalAccounts: {}, transfers: {}, cards: {} },
  // Stripe Issuing: cards, authorizations, settled transactions, disputes, and the ephemeral keys handed to the browser.
  stripe: { cards: {}, authorizations: [], transactions: [], disputes: [], keys: {} },
  // ERC-20 allowances: allowances["chainId:token:owner:spender"] = raw amount.
  allowances: {},
  // Names of edges that fail: "rpc:<chainId>", "kraken", "privy", "lifi", "transfers" (Alchemy's transfer index), "resend", "push".
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
  // Cloudflare Access: the team's signing key, published as JWKS, and tokens for operators.
  const access = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const accessJwk = { ...access.publicKey.export({ format: "jwk" }), kid: "e2e-access-key", alg: "RS256", use: "sig" };
  function cfAccessToken({ email = OPERATOR.email, audience = OPERATOR.audience, expiresIn = 3600, key = access.privateKey } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const input = `${base64urlOf({ alg: "RS256", kid: "e2e-access-key", typ: "JWT" })}.${base64urlOf({ aud: [audience], email, sub: randomUUID(), iss: `http://127.0.0.1:${port}/access`,
      iat: now, nbf: now, exp: now + expiresIn, type: "app", identity_nonce: randomUUID() })}`;
    return `${input}.${sign("sha256", Buffer.from(input), key).toString("base64url")}`;
  }

  const base64urlOf = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
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

  /**
   * Native ETH history: each mined transaction keeps how it changed native
   * balances (`tx.native`), so `eth_getBalance` at a past block is today's
   * balance less every later change, as an archive node answers. Balances set
   * directly by a test count as before the first block.
   */
  const nativeBook = (chainId) => ({ ...state.balances[chainId]?.native });
  function nativeChange(chainId, before) {
    const after = state.balances[chainId]?.native ?? {};
    const change = {};
    for (const owner of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const delta = BigInt(after[owner] ?? "0") - BigInt(before[owner] ?? "0");
      if (delta !== 0n) change[owner] = delta.toString();
    }
    return change;
  }
  function balanceAt(chainId, owner, tag) {
    let total = balance(chainId, "native", owner);
    if (typeof tag !== "string" || !/^0x[0-9a-f]+$/i.test(tag)) return total;
    const number = Number.parseInt(tag, 16);
    for (const tx of Object.values(state.txs)) {
      if (tx.chainId === chainId && tx.blockNumber > number) total -= BigInt(tx.native?.[owner.toLowerCase()] ?? "0");
    }
    return total;
  }

  /** Put a transaction in the next block. */
  function mine(tx) {
    const hash = `0x${randomBytes(32).toString("hex")}`;
    state.head += 1;
    state.txs[hash] = { ...tx, from: tx.from.toLowerCase(), to: tx.to.toLowerCase(), blockNumber: state.head, at: new Date().toISOString() };
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
      else if (functionName === "approve") moves.push({ approve: true, token: call.to, spender: args[0], amount: args[1] });
      else if (to === AAVE_POOL && functionName === "supply") {
        // Aave: the asset goes to the pool, the account gets aTokens one for one.
        const [asset, amount, onBehalfOf] = args;
        moves.push({ token: asset, to: AAVE_POOL, amount }, { mint: true, token: aTokenFor(asset), to: onBehalfOf.toLowerCase(), amount, from: ZERO },
          { log: eventLog(AAVE_POOL, aaveSupplyEvent, { reserve: asset, onBehalfOf, referralCode: 0 }, [["address", from], ["uint256", amount]]) });
      } else if (to === AAVE_POOL && functionName === "withdraw") {
        // The largest amount asks Aave for the whole balance, as the real pool does.
        const [asset, requested, receiver] = args;
        const amount = requested === maxUint256 ? balance(chainId, aTokenFor(asset), from) : requested;
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
      if (item.approve) {
        state.approvals[`${chainId}:${from.toLowerCase()}`] = { token: item.token.toLowerCase(), amount: item.amount };
        state.allowances[`${chainId}:${item.token.toLowerCase()}:${from.toLowerCase()}:${item.spender.toLowerCase()}`] = item.amount.toString();
        logs.push({ address: item.token.toLowerCase(), topics: encodeEventTopics({ abi: [approvalEvent], eventName: "Approval", args: { owner: from, spender: item.spender } }),
          data: encodeAbiParameters([{ type: "uint256" }], [item.amount]) });
        continue;
      }
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
    const before = nativeBook(chainId);
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
    const hash = mine({ chainId, from, to, value: `0x${amount.toString(16)}`, input: data, success, logs, native: nativeChange(chainId, before) });
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
    const before = nativeBook(chainId);
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
    const hash = mine({ chainId, from: BUNDLER, to: ENTRY_POINT, value: "0x0", input, success: true, logs, native: nativeChange(chainId, before) });
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
    if (functionName === "allowance") return encodeFunctionResult({ abi, functionName,
      result: BigInt(state.allowances[`${chainId}:${to.toLowerCase()}:${args[0].toLowerCase()}:${args[1].toLowerCase()}`] ?? "0") });
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

  /** Alchemy's transfer index: native and token transfers to an address, newest first, from the chain's own transactions and logs. */
  function assetTransfers(chainId, { toAddress }) {
    const owner = toAddress.toLowerCase();
    const topic = encodeEventTopics({ abi: [transferEvent], eventName: "Transfer" })[0];
    const rows = [];
    for (const [hash, tx] of Object.entries(state.txs)) {
      if (tx.chainId !== chainId || !tx.success) continue;
      const common = { blockNum: `0x${tx.blockNumber.toString(16)}`, hash, to: owner, metadata: { blockTimestamp: tx.at } };
      if (tx.to === owner && BigInt(tx.value ?? "0x0") > 0n) rows.push({ ...common, uniqueId: `${hash}:external`, from: tx.from, category: "external", rawContract: { value: tx.value, address: null } });
      tx.logs.forEach((log, index) => {
        if (log.topics?.[0] !== topic || `0x${log.topics[2].slice(26)}`.toLowerCase() !== owner) return;
        rows.push({ ...common, uniqueId: `${hash}:log:${index}`, from: `0x${log.topics[1].slice(26)}`, category: "erc20", rawContract: { value: log.data, address: log.address } });
      });
    }
    return { transfers: rows.sort((a, b) => Number.parseInt(b.blockNum, 16) - Number.parseInt(a.blockNum, 16)) };
  }

  /** Money arriving from outside Aura: someone sends a token (or ETH) to an address. */
  function receive({ chainId, to, token = "native", amount, from = "0x5555555555555555555555555555555555555555" }) {
    const value = BigInt(amount);
    const key = token.toLowerCase();
    state.balances[chainId] ??= {}; state.balances[chainId][key] ??= {};
    state.balances[chainId][key][to.toLowerCase()] = (balance(chainId, key, to) + value).toString();
    return key === "native"
      ? mine({ chainId, from, to, value: `0x${value.toString(16)}`, input: "0x", success: true, logs: [], native: { [to.toLowerCase()]: value.toString() } })
      : mine({ chainId, from, to: key, value: "0x0", input: "0x", success: true, logs: [{ address: key,
        topics: encodeEventTopics({ abi: [transferEvent], eventName: "Transfer", args: { from, to } }), data: encodeAbiParameters([{ type: "uint256" }], [value]) }] });
  }

  function rpc(chainId, request) {
    const { id, method, params } = request;
    const result = (value) => ({ jsonrpc: "2.0", id, result: value });
    if (method === "eth_chainId") return result(`0x${chainId.toString(16)}`);
    if (method === "eth_blockNumber") return result(`0x${state.head.toString(16)}`);
    if (method === "eth_getBlockByNumber") return result(block(params[0]));
    if (method === "alchemy_getAssetTransfers") return state.down.includes("transfers") ? { jsonrpc: "2.0", id, error: { code: -32000, message: "unavailable" } }
      : result(assetTransfers(chainId, params[0]));
    if (method === "eth_getBalance") return result(`0x${balanceAt(chainId, params[0], params[1]).toString(16)}`);
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
      value: quote.toToken ? "0x0" : `0x${quote.toAmount.toString(16)}`, input: "0x", success: true, logs,
      native: quote.toToken ? {} : { [quote.toAddress]: quote.toAmount.toString() } });
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
    const raw = Buffer.concat(chunks).toString();
    // Stripe takes form-encoded bodies; everything else here is JSON.
    const form = req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded") ? new URLSearchParams(raw) : null;
    const body = chunks.length && !form ? JSON.parse(raw) : null;
    // The browser's fake wallet and wagmi reads come from the app's origin.
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
    const send = (status, payload) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(payload)); };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const down = (name) => state.down.includes(name);

    // Test controls.
    if (url.pathname === "/__reset") { state = initialState(); return send(200, { ok: true }); }
    if (url.pathname === "/__state") { state = { ...state, ...body, users: { ...state.users, ...body?.users }, balances: { ...state.balances, ...body?.balances } }; return send(200, { ok: true }); }
    if (url.pathname === "/__access") return send(200, { token: cfAccessToken({ ...body, key: body?.forged ? generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey : access.privateKey }) });
    if (url.pathname === "/access/cdn-cgi/access/certs") return send(200, { keys: [accessJwk], public_cert: { kid: "e2e-access-key" } });
    if (url.pathname === "/__session") return send(200, { token: accessToken(body.userId, body) });
    if (url.pathname === "/__sent") return send(200, { sent: state.sent });
    if (url.pathname === "/__link-email") { state.users[body.userId] = { ...state.users[body.userId], email: body.email }; return send(200, { ok: true }); }
    // Bridge controls: approve or reject identity verification, deliver a bank deposit, move a payout along.
    if (url.pathname === "/__bridge/kyc") {
      const link = Object.values(state.bridgeXyz.kycLinks).find((item) => item.email === body.email);
      if (!link) return send(404, { error: "no kyc link for that email" });
      Object.assign(link, body.status === "rejected" ? { kyc_status: "rejected" } : { kyc_status: "approved", tos_status: "approved", customer_id: link.customer_id ?? `cus_${randomUUID().slice(0, 8)}` });
      return send(200, link);
    }
    if (url.pathname === "/__bridge/deposit") {
      const link = Object.values(state.bridgeXyz.kycLinks).find((item) => item.email === body.email);
      const account = link?.customer_id && state.bridgeXyz.accounts[link.customer_id];
      if (!account) return send(404, { error: "no USD account for that email" });
      const hash = receive({ chainId: 8453, to: account.destination.address, token: USDC_BASE, amount: String(Math.round(Number(body.amount) * 1e6)), from: BRIDGE.sender });
      (state.bridgeXyz.history[account.id] ??= []).push({ id: randomUUID(), type: "payment_processed", customer_id: link.customer_id, virtual_account_id: account.id,
        amount: body.amount, currency: "usdc", destination_tx_hash: hash, created_at: new Date().toISOString(),
        source: { payment_rail: "ach_push", sender_name: body.senderName ?? "Jane Customer", bank_name: "Chase" } });
      return send(200, { hash });
    }
    if (url.pathname === "/__bridge/transfer") {
      const transfers = Object.values(state.bridgeXyz.transfers);
      const transfer = body.id ? state.bridgeXyz.transfers[body.id] : transfers.at(-1);
      if (!transfer) return send(404, { error: "no transfer" });
      transfer.state = body.state;
      return send(200, transfer);
    }
    // Bridge approves (or not) a verified customer for cards, and creates their Stripe cardholder.
    if (url.pathname === "/__bridge/cards") {
      const link = Object.values(state.bridgeXyz.kycLinks).find((item) => item.email === body.email);
      if (!link?.customer_id) return send(404, { error: "no verified customer" });
      state.bridgeXyz.cards[link.customer_id] = { status: body.status ?? "approved", cardholder: (body.status ?? "approved") === "approved" ? `ich_${link.customer_id}` : null };
      return send(200, { ok: true });
    }
    // A purchase with the card: Stripe asks, Bridge pulls the USDC from the account just in time, or it's declined.
    if (url.pathname === "/__stripe/authorize") {
      const card = Object.values(state.stripe.cards).at(-1);
      if (!card) return send(404, { error: "no card" });
      const cents = Math.round(Number(body.amount) * 100);
      const raw = BigInt(cents) * 10_000n;
      const owner = card.crypto_wallet.address.toLowerCase();
      const allowanceKey = `8453:${USDC_BASE}:${owner}:${BRIDGE.cardsSpender}`;
      const daily = card.spending_controls.spending_limits.find((limit) => limit.interval === "daily")?.amount ?? Infinity;
      const spentToday = state.stripe.authorizations.filter((item) => item.card === card.id && item.approved).reduce((sum, item) => sum + item.amount, 0);
      const approved = card.status === "active" && cents + spentToday <= daily && BigInt(state.allowances[allowanceKey] ?? "0") >= raw && balance(8453, USDC_BASE, owner) >= raw;
      let hash = null;
      if (approved) {
        state.allowances[allowanceKey] = (BigInt(state.allowances[allowanceKey]) - raw).toString();
        move(8453, USDC_BASE, owner, BRIDGE.cardsSpender, raw);
        hash = mine({ chainId: 8453, from: BRIDGE.cardsSpender, to: USDC_BASE, value: "0x0", input: "0x", success: true,
          logs: [{ address: USDC_BASE, topics: encodeEventTopics({ abi: [transferEvent], eventName: "Transfer", args: { from: owner, to: BRIDGE.cardsSpender } }),
            data: encodeAbiParameters([{ type: "uint256" }], [raw]) }] });
      }
      const authorization = { id: `iauth_${randomUUID().slice(0, 8)}`, object: "issuing.authorization", card: card.id, amount: cents, currency: "usd", approved,
        status: approved ? "pending" : "closed", created: Math.floor(Date.now() / 1000), merchant_data: { name: body.merchant ?? "Corner Cafe" },
        crypto_transactions: hash ? [{ crypto_transaction_confirmed: { transaction_hash: hash, amount: (cents / 100).toFixed(2) } }] : [] };
      state.stripe.authorizations.push(authorization);
      return send(200, authorization);
    }
    // The merchant settles the latest pending purchase.
    if (url.pathname === "/__stripe/capture") {
      const authorization = state.stripe.authorizations.findLast((item) => item.status === "pending");
      if (!authorization) return send(404, { error: "nothing to capture" });
      authorization.status = "closed";
      const transaction = { id: `ipi_${randomUUID().slice(0, 8)}`, object: "issuing.transaction", card: authorization.card, type: "capture", amount: -authorization.amount,
        currency: "usd", created: Math.floor(Date.now() / 1000), authorization: authorization.id, dispute: null, merchant_data: authorization.merchant_data };
      state.stripe.transactions.push(transaction);
      return send(200, transaction);
    }
    if (url.pathname === "/__stripe/state") return send(200, state.stripe);
    if (url.pathname === "/__outbox") return send(200, { emails: state.emails, pushes: state.pushes });
    if (url.pathname === "/__balances") {
      // Set individual balances without touching any other wallet's.
      for (const { chainId, token, owner, amount } of body) {
        state.balances[chainId] ??= {};
        state.balances[chainId][token.toLowerCase()] ??= {};
        state.balances[chainId][token.toLowerCase()][owner.toLowerCase()] = amount;
      }
      return send(200, { ok: true });
    }
    if (url.pathname === "/__receive") return send(200, { hash: receive(body) });
    if (url.pathname === "/__wallet/send") {
      if (down(`rpc:${body.chainId}`)) return send(503, { error: "unavailable" });
      return send(200, { hash: sendTransaction(body) });
    }

    // Privy's REST API: an operator's search by email or wallet address.
    const lookup = /^\/privy\/v1\/users\/(email|wallet)\/address$/.exec(url.pathname);
    if (lookup) {
      const wanted = String(body?.address ?? "").toLowerCase();
      const match = Object.entries(state.users).find(([, user]) => lookup[1] === "email" ? user.email?.toLowerCase() === wanted : user.wallet?.toLowerCase() === wanted);
      return match ? send(200, privyUser(match[0])) : send(404, { error: "User not found" });
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
      if (!owner || !["wallet_sendCalls", "personal_sign"].includes(body?.method)) return send(404, { error: "wallet not found" });
      // A passkey confirmation (lib/security/step-up.ts): Privy signs the message only for a valid authorization signature.
      if (body.method === "personal_sign") {
        if (state.relay === "reject") return send(400, { error: "Invalid authorization signature" });
        state.confirmations = [...(state.confirmations ?? []), body.params.message];
        return send(200, { method: "personal_sign", data: { signature: `0x${"ab".repeat(65)}`, encoding: "hex" } });
      }
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

    // Bridge's API (bank accounts): api key checked, JSON in and out.
    if (url.pathname.startsWith("/bridge/v0/")) {
      if (down("bridge")) return send(503, { message: "unavailable" });
      if (req.headers["api-key"] !== "bridge-e2e-key") return send(401, { message: "invalid api key" });
      const path = url.pathname.slice("/bridge/v0".length);
      const bridge = state.bridgeXyz;
      const link = /^\/kyc_links(?:\/([^/]+))?$/.exec(path);
      if (link && req.method === "POST") {
        const existing = Object.values(bridge.kycLinks).find((item) => item.email === body.email);
        if (existing) return send(200, existing);
        const id = `kyc_${randomUUID().slice(0, 8)}`;
        bridge.kycLinks[id] = { id, email: body.email, full_name: body.full_name, customer_id: null, kyc_link: `https://bridge.aura-e2e.test/kyc/${id}`,
          tos_link: `https://bridge.aura-e2e.test/tos/${id}`, kyc_status: "not_started", tos_status: "pending" };
        return send(200, bridge.kycLinks[id]);
      }
      if (link) return bridge.kycLinks[link[1]] ? send(200, bridge.kycLinks[link[1]]) : send(404, { message: "not found" });
      const customer = /^\/customers\/([^/]+)$/.exec(path);
      if (customer) {
        const cards = bridge.cards[customer[1]];
        return send(200, { id: customer[1], status: "active", stripe_cardholder_id: cards?.cardholder ?? null,
          endorsements: [{ name: "base", status: "approved" }, ...(cards ? [{ name: "cards", status: cards.status, requirements: { issues: cards.status === "incomplete" ? ["Confirm your address"] : [] } }] : [])] });
      }
      const cardsLink = /^\/customers\/([^/]+)\/kyc_link$/.exec(path);
      if (cardsLink) return send(200, { url: `https://bridge.aura-e2e.test/cards/${cardsLink[1]}?endorsement=${url.searchParams.get("endorsement")}` });
      const accounts = /^\/customers\/([^/]+)\/virtual_accounts$/.exec(path);
      if (accounts && req.method === "POST") {
        const customer = accounts[1];
        bridge.accounts[customer] ??= { id: `va_${customer}`, customer_id: customer, status: "activated",
          destination: { currency: "usdc", payment_rail: "base", address: body.destination.address.toLowerCase() },
          source_deposit_instructions: { currency: "usd", payment_rails: ["ach_push", "wire"], bank_name: "Lead Bank", bank_address: "1801 Main St, Kansas City, MO",
            bank_beneficiary_name: "Aura Customer", bank_beneficiary_address: "1 Test St, New York, NY", bank_account_number: "900123456789", bank_routing_number: "101019644" } };
        return send(200, bridge.accounts[customer]);
      }
      if (accounts) return send(200, { data: bridge.accounts[accounts[1]] ? [bridge.accounts[accounts[1]]] : [] });
      const history = /^\/customers\/([^/]+)\/virtual_accounts\/([^/]+)\/history$/.exec(path);
      if (history) return send(200, { count: (bridge.history[history[2]] ?? []).length, data: [...(bridge.history[history[2]] ?? [])].reverse() });
      const external = /^\/customers\/([^/]+)\/external_accounts$/.exec(path);
      if (external && req.method === "POST") {
        const id = `ext_${randomUUID().slice(0, 8)}`;
        bridge.externalAccounts[id] = { id, customer_id: external[1], bank_name: body.bank_name, account_owner_name: body.account_owner_name,
          account: { last_4: String(body.account?.account_number ?? "").slice(-4) }, active: true };
        return send(200, bridge.externalAccounts[id]);
      }
      const removed = /^\/customers\/([^/]+)\/external_accounts\/([^/]+)$/.exec(path);
      if (removed && req.method === "DELETE") {
        const account = bridge.externalAccounts[removed[2]];
        if (!account || account.customer_id !== removed[1]) return send(404, { message: "not found" });
        delete bridge.externalAccounts[removed[2]];
        return send(200, { ...account, active: false });
      }
      const transfer = /^\/transfers(?:\/([^/]+))?$/.exec(path);
      if (transfer && req.method === "POST") {
        const id = `tr_${randomUUID().slice(0, 8)}`;
        bridge.transfers[id] = { id, state: "awaiting_funds", on_behalf_of: body.on_behalf_of, amount: body.amount, destination: body.destination,
          source_deposit_instructions: { payment_rail: "base", currency: "usdc", to_address: BRIDGE.payoutDeposit, amount: body.amount } };
        return send(200, bridge.transfers[id]);
      }
      if (transfer) return bridge.transfers[transfer[1]] ? send(200, bridge.transfers[transfer[1]]) : send(404, { message: "not found" });
      return send(404, { message: `no fake for ${path}` });
    }

    // What Stripe's frames show for a card, only with an ephemeral key made for that card and nonce.
    if (url.pathname === "/stripe-js/reveal") {
      const key = state.stripe.keys[body?.ephemeralKeySecret];
      if (!key || key.card !== body.cardId || key.nonce !== body.nonce) return send(401, { error: { message: "Invalid ephemeral key" } });
      const card = state.stripe.cards[key.card];
      return send(200, { number: `4000 0000 0000 ${card.last4}`, expiry: `${String(card.exp_month).padStart(2, "0")}/${String(card.exp_year).slice(-2)}`, cvc: "314" });
    }

    // Stripe Issuing: secret key checked, form-encoded in, JSON out.
    if (url.pathname.startsWith("/stripe/v1/")) {
      if (down("stripe")) return send(503, { error: { message: "unavailable" } });
      if (req.headers.authorization !== "Bearer sk_test_e2e") return send(401, { error: { message: "Invalid API Key provided" } });
      const path = url.pathname.slice("/stripe/v1".length);
      const stripe = state.stripe;
      const field = (name) => form?.get(name) ?? undefined;
      const list = (items) => send(200, { object: "list", data: [...items].reverse(), has_more: false });
      if (path === "/issuing/cards" && req.method === "POST") {
        const id = `ic_${randomUUID().slice(0, 8)}`;
        stripe.cards[id] = { id, object: "issuing.card", brand: "Visa", cardholder: field("cardholder"), currency: "usd", type: field("type"), status: field("status") ?? "active",
          last4: String(1000 + Object.keys(stripe.cards).length * 1111).slice(-4), exp_month: 9, exp_year: 2029,
          crypto_wallet: { chain: field("crypto_wallet[chain]"), currency: field("crypto_wallet[currency]"), type: field("crypto_wallet[type]"), address: field("crypto_wallet[address]") },
          spending_controls: { spending_limits: [{ amount: Number(field("spending_controls[spending_limits][0][amount]")), interval: field("spending_controls[spending_limits][0][interval]") }] },
          wallets: { apple_pay: { eligible: true, ineligible_reason: null }, google_pay: { eligible: true, ineligible_reason: null } } };
        return send(200, stripe.cards[id]);
      }
      const card = /^\/issuing\/cards\/([^/]+)$/.exec(path);
      if (card) {
        const item = stripe.cards[card[1]];
        if (!item) return send(404, { error: { message: "No such issuing card" } });
        // "stripe:card-read" in `down` fails only reading a card, so changing it still works.
        if (req.method === "GET" && down("stripe:card-read")) return send(503, { error: { message: "unavailable" } });
        if (req.method === "POST") {
          if (field("status")) item.status = field("status");
          const amount = field("spending_controls[spending_limits][0][amount]");
          if (amount) item.spending_controls = { spending_limits: [{ amount: Number(amount), interval: field("spending_controls[spending_limits][0][interval]") }] };
        }
        return send(200, item);
      }
      const since = Number(url.searchParams.get("created[gte]") ?? 0);
      const until = Number(url.searchParams.get("created[lt]") ?? Infinity);
      const forCard = (items) => items.filter((item) => item.card === url.searchParams.get("card") && item.created >= since && item.created < until);
      if (path === "/issuing/authorizations") return list(forCard(stripe.authorizations));
      if (path === "/issuing/transactions") return list(forCard(stripe.transactions));
      if (path === "/issuing/disputes" && req.method === "POST") {
        const transaction = stripe.transactions.find((item) => item.id === field("transaction"));
        if (!transaction) return send(400, { error: { message: "No such transaction" } });
        const reason = field("evidence[reason]");
        const dispute = { id: `idp_${randomUUID().slice(0, 8)}`, object: "issuing.dispute", status: "unsubmitted", transaction: transaction.id, amount: -transaction.amount,
          created: Math.floor(Date.now() / 1000), evidence: { reason, explanation: field(`evidence[${reason}][explanation]`) } };
        stripe.disputes.push(dispute);
        return send(200, dispute);
      }
      if (path === "/issuing/disputes") return list(stripe.disputes);
      const submit = /^\/issuing\/disputes\/([^/]+)\/submit$/.exec(path);
      if (submit) {
        const dispute = stripe.disputes.find((item) => item.id === submit[1]);
        if (!dispute || dispute.status !== "unsubmitted") return send(400, { error: { message: "Dispute can't be submitted" } });
        dispute.status = "submitted";
        stripe.transactions.find((item) => item.id === dispute.transaction).dispute = dispute.id;
        return send(200, dispute);
      }
      if (path === "/ephemeral_keys" && req.method === "POST") {
        if (!stripe.cards[field("issuing_card")] || !field("nonce")) return send(400, { error: { message: "Invalid request" } });
        const secret = `ek_test_${randomBytes(12).toString("hex")}`;
        stripe.keys[secret] = { card: field("issuing_card"), nonce: field("nonce") };
        return send(200, { id: `ephkey_${randomUUID().slice(0, 8)}`, object: "ephemeral_key", secret });
      }
      return send(404, { error: { message: `no fake for ${path}` } });
    }

    // Resend's email API, and a browser push service (Aura sends the fake plain JSON; real push services get it encrypted).
    if (url.pathname === "/resend/emails") {
      if (down("resend")) return send(503, { message: "unavailable" });
      if (req.headers.authorization !== "Bearer re_e2e_fake") return send(401, { message: "API key is invalid" });
      state.emails.push({ ...body, idempotencyKey: req.headers["idempotency-key"] });
      return send(200, { id: randomUUID() });
    }
    const pushed = /^\/push\/([^/]+)$/.exec(url.pathname);
    if (pushed) {
      if (down("push")) return send(503, { error: "unavailable" });
      state.pushes.push({ subscription: pushed[1], ...body });
      return send(201, {});
    }

    // Kraken.
    if (url.pathname === "/kraken/0/public/OHLC") return down("kraken") ? send(503, { error: ["EService:Unavailable"] }) : send(200, kraken(url));

    send(404, { error: `no fake for ${url.pathname}` });
  });

  // Aura's key for signing push messages, made fresh for each run.
  const vapid = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  const vapidPublic = Buffer.concat([Buffer.from([4]), Buffer.from(vapid.x, "base64url"), Buffer.from(vapid.y, "base64url")]).toString("base64url");

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
      CF_ACCESS_TEAM_DOMAIN: `http://127.0.0.1:${port}/access`,
      CF_ACCESS_AUD: OPERATOR.audience,
      RESEND_API_URL: `http://127.0.0.1:${port}/resend`,
      RESEND_API_KEY: "re_e2e_fake",
      EMAIL_FROM: "Aura <notices@aura-e2e.test>",
      APP_ORIGIN: "https://aura-e2e.test",
      VAPID_PUBLIC_KEY: vapidPublic,
      VAPID_PRIVATE_KEY: vapid.d,
      BRIDGE_API_KEY: "bridge-e2e-key",
      BRIDGE_API_BASE_URL: `http://127.0.0.1:${port}/bridge/v0`,
      STRIPE_API_URL: `http://127.0.0.1:${port}/stripe`,
      STRIPE_SECRET_KEY: "sk_test_e2e",
      STRIPE_PUBLISHABLE_KEY: "pk_test_e2e",
      BRIDGE_CARDS_SPENDER: BRIDGE.cardsSpender,
      INTERCOM_APP_ID: "e2eapp",
      INTERCOM_IDENTITY_SECRET: "e2e-intercom-identity-secret"
    },
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(done))
  })));
}
