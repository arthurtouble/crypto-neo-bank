// Token amounts between raw integers and decimal strings: the same results as viem's formatUnits and parseUnits
// (tests/unit/units.test.ts checks them against viem). Screens import these instead of viem so a page doesn't pull
// viem's shared chunk, which the bundler groups with the wallet runtime.

/** 420000000000n with 9 decimals → "420". */
export function formatUnits(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`\`decimals\` must be a non-negative integer. Got \`${decimals}\`.`);
  let display = value.toString();
  const negative = display.startsWith("-");
  if (negative) display = display.slice(1);
  display = display.padStart(decimals, "0");
  const integer = display.slice(0, display.length - decimals);
  const fraction = display.slice(display.length - decimals).replace(/(0+)$/, "");
  return `${negative ? "-" : ""}${integer || "0"}${fraction ? `.${fraction}` : ""}`;
}

/** Adds 1 to a digit string with carry; one digit longer only when the carry overflows. */
function carry(digits: string): string {
  const out = digits.split("");
  for (let index = out.length - 1; index >= 0; index -= 1) {
    const digit = Number.parseInt(out[index], 10) + 1;
    if (digit < 10) { out[index] = String(digit); return out.join(""); }
    out[index] = "0";
  }
  return `1${out.join("")}`;
}

/** "420" with 9 decimals → 420000000000n. Rounds half away from zero past the token's decimals; throws on anything that isn't a decimal number. */
export function parseUnits(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error(`\`decimals\` must be a non-negative integer. Got \`${decimals}\`.`);
  if (!/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value)) throw new Error(`Value \`${value}\` is not a valid decimal number.`);
  let [integer = "", fraction = "0"] = value.split(".");
  const negative = integer.startsWith("-");
  if (negative) integer = integer.slice(1);
  if (integer === "") integer = "0";
  fraction = fraction.replace(/(0+)$/, "");
  if (decimals === 0) {
    if (fraction.length > 0 && Number.parseInt(fraction[0], 10) >= 5) integer = `${BigInt(integer) + 1n}`;
    fraction = "";
  } else if (fraction.length > decimals) {
    const left = fraction.slice(0, decimals);
    if (Number.parseInt(fraction.slice(decimals, decimals + 1), 10) >= 5) {
      const carried = carry(left);
      if (carried.length > decimals) { fraction = carried.slice(1); integer = `${BigInt(integer) + 1n}`; }
      else fraction = carried;
    } else fraction = left;
  } else fraction = fraction.padEnd(decimals, "0");
  return BigInt(`${negative ? "-" : ""}${integer}${fraction}`);
}
