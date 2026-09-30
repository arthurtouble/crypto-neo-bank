/** A wallet address shortened for display: the first six and last four characters. */
export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
