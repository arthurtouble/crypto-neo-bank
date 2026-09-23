const chainIds = new Map([
  ["base-rpc.publicnode.com", 8453], ["ethereum-rpc.publicnode.com", 1], ["arb1.arbitrum.io", 42161],
  ["mainnet.optimism.io", 10], ["polygon-bor-rpc.publicnode.com", 137]
]);
const baseContracts = {
  provider: "0xe20fcbdBffc4dd138ce8b2e6fbb6cb49777ad64d".toLowerCase(),
  pool: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5",
  usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  weth: "0x4200000000000000000000000000000000000006"
};
const observed = new Set();

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.hostname === "li.quest") return Response.json({ transactionRequest: { to: "0x1111111111111111111111111111111111111111" }, estimate: { toAmount: "997500" }, tool: "eco" });
  const body = JSON.parse(init.body);
  const chainId = chainIds.get(url.hostname);
  if (!chainId) throw new Error(`Unexpected RPC host: ${url.hostname}`);
  const pool = process.env.AUREL_TEST_BAD_POOL ? "0x2222222222222222222222222222222222222222" : "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const address = String(body.params?.[0] ?? "").toLowerCase();
  if (chainId === 8453 && body.method === "eth_getCode") {
    if (!Object.values(baseContracts).includes(address)) throw new Error(`Unexpected Base code address: ${address}`);
    observed.add(`code:${address}`);
  }
  if (body.method === "eth_call") {
    if (chainId !== 8453 || !body.params?.[0] || typeof body.params[0] !== "object" || String(body.params[0].to).toLowerCase() !== baseContracts.provider || body.params[0].data !== "0x026b1d5f")
      throw new Error("Unexpected Aave provider call.");
    observed.add("getPool");
  }
  const missing = process.env.AUREL_TEST_MISSING_CODE;
  const missingAddress = missing && baseContracts[missing];
  const result = body.method === "eth_chainId" ? `0x${chainId.toString(16)}`
    : body.method === "eth_getCode" ? missingAddress === address ? "0x" : process.env.AUREL_TEST_MALFORMED_CODE && address === baseContracts.pool ? "0x0" : "0x6000"
    : body.method === "eth_call" ? `0x${pool.slice(2).toLowerCase().padStart(64, "0")}` : null;
  return Response.json({ jsonrpc: "2.0", id: body.id, result });
};

process.on("beforeExit", () => {
  if (process.env.AUREL_TEST_BAD_POOL || process.env.AUREL_TEST_MISSING_CODE || process.env.AUREL_TEST_MALFORMED_CODE) return;
  for (const address of Object.values(baseContracts)) if (!observed.has(`code:${address}`)) throw new Error(`Missing Aave code check: ${address}`);
  if (!observed.has("getPool")) throw new Error("Missing Aave getPool check.");
});
