/** Server-side display formats shared by notices, records, and API answers. */

/** Whole cents as a dollar amount with two decimals, e.g. 1234 → "12.34". The sign is kept; pass `Math.abs` for a magnitude. */
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** An address shortened for display: the first six and last four characters, e.g. "0x1234…abcd". The screens' own. */
export { shortAddress } from "@/lib/format";
