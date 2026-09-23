const chainIds = new Map([
  ["base-rpc.publicnode.com", 8453], ["ethereum-rpc.publicnode.com", 1], ["arb1.arbitrum.io", 42161],
  ["mainnet.optimism.io", 10], ["polygon-bor-rpc.publicnode.com", 137]
]);
const baseContracts = {
  provider: "0xe20fcbdBffc4dd138ce8b2e6fbb6cb49777ad64d".toLowerCase(),
  pool: "0xa238dd80c259a72e81d7e4664a9801593f98d1c5",
  oracle: "0x2cc0fc26ed4563a5ce5e8bdcfe1a2878676ae156",
  dataProvider: "0x0f43731eb8d45a581f4a36dd74f5f358bc90c73a",
  usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  weth: "0x4200000000000000000000000000000000000006"
};
const lifi = {
  diamond: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
  facet: "0x31a9b1835864706af10103b31ea2b79bdb995f5f"
};
const lifiFacetCall = `0xcdffacc6${"5fd9ae2e".padEnd(64, "0")}`;
const observed = new Set();

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  if (url.hostname === "li.quest") return Response.json({ transactionRequest: { to: "0x1111111111111111111111111111111111111111" }, estimate: { toAmount: "997500" }, tool: "eco" });
  const body = JSON.parse(init.body);
  const chainId = chainIds.get(url.hostname);
  if (!chainId) throw new Error(`Unexpected RPC host: ${url.hostname}`);
  const returnedAddress = {
    "0x026b1d5f": process.env.AUREL_TEST_BAD_POOL ? "0x2222222222222222222222222222222222222222" : baseContracts.pool,
    "0xfca513a8": process.env.AUREL_TEST_BAD_ORACLE ? "0x2222222222222222222222222222222222222222" : baseContracts.oracle,
    "0xe860accb": process.env.AUREL_TEST_BAD_DATA_PROVIDER ? "0x2222222222222222222222222222222222222222" : baseContracts.dataProvider
  };
  const address = String(body.params?.[0] ?? "").toLowerCase();
  if (chainId === 8453 && body.method === "eth_getCode") {
    if (![...Object.values(baseContracts), ...Object.values(lifi)].includes(address)) throw new Error(`Unexpected Base code address: ${address}`);
    observed.add(`code:${address}`);
  }
  if (body.method === "eth_call") {
    const call = body.params?.[0];
    const aaveCall = String(call?.to).toLowerCase() === baseContracts.provider && Object.hasOwn(returnedAddress, call?.data);
    const lifiCall = String(call?.to).toLowerCase() === lifi.diamond && call?.data === lifiFacetCall;
    if (chainId !== 8453 || !call || typeof call !== "object" || (!aaveCall && !lifiCall))
      throw new Error("Unexpected governed contract call.");
    observed.add(body.params[0].data);
  }
  const missing = process.env.AUREL_TEST_MISSING_CODE;
  const missingAddress = missing && baseContracts[missing];
  const result = body.method === "eth_chainId" ? `0x${chainId.toString(16)}`
    : body.method === "eth_getCode" ? missingAddress === address || process.env.AUREL_TEST_MISSING_LIFI_FACET_CODE && address === lifi.facet
      ? "0x" : process.env.AUREL_TEST_MALFORMED_CODE && address === baseContracts.pool ? "0x0" : "0x6000"
    : body.method === "eth_call" ? `0x${(body.params[0].data === lifiFacetCall
      ? process.env.AUREL_TEST_BAD_LIFI_FACET ? "0x2222222222222222222222222222222222222222" : lifi.facet
      : returnedAddress[body.params[0].data]).slice(2).toLowerCase().padStart(64, "0")}` : null;
  return Response.json({ jsonrpc: "2.0", id: body.id, result });
};

process.on("beforeExit", () => {
  if (process.env.AUREL_TEST_BAD_POOL || process.env.AUREL_TEST_BAD_ORACLE || process.env.AUREL_TEST_BAD_DATA_PROVIDER
    || process.env.AUREL_TEST_MISSING_CODE || process.env.AUREL_TEST_MALFORMED_CODE
    || process.env.AUREL_TEST_BAD_LIFI_FACET || process.env.AUREL_TEST_MISSING_LIFI_FACET_CODE) return;
  for (const address of Object.values(baseContracts)) if (!observed.has(`code:${address}`)) throw new Error(`Missing Aave code check: ${address}`);
  for (const address of Object.values(lifi)) if (!observed.has(`code:${address}`)) throw new Error(`Missing LI.FI code check: ${address}`);
  if (!observed.has(lifiFacetCall)) throw new Error("Missing LI.FI mounted facet check.");
  for (const selector of ["0x026b1d5f", "0xfca513a8", "0xe860accb"])
    if (!observed.has(selector)) throw new Error(`Missing Aave provider check: ${selector}`);
});
