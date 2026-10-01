// Calldata for ERC-20 `transfer(address,uint256)`, the same bytes as viem's encodeFunctionData with erc20Abi
// (tests/unit/erc20-transfer.test.ts checks it against viem). Screens use this instead of viem so a page doesn't pull
// viem's shared chunk, which the bundler groups with the wallet runtime.

const TRANSFER_SELECTOR = "a9059cbb";
const MAX_UINT256 = (1n << 256n) - 1n;

export function erc20TransferData(to: `0x${string}`, amount: bigint): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new Error(`Address "${to}" is invalid.`);
  if (amount < 0n || amount > MAX_UINT256) throw new Error(`Amount ${amount} is out of range for uint256.`);
  return `0x${TRANSFER_SELECTOR}${to.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
}
