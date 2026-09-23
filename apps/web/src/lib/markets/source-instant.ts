// Market feeds may report more precision than JavaScript Date. Keep the source
// cursor intact so distinct trades within one millisecond cannot be collapsed.
const utcInstant = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/;

export function sourceInstantNs(value: string): bigint | null {
  const match = utcInstant.exec(value);
  if (!match) return null;
  const second = Date.parse(`${match[1]}Z`);
  if (!Number.isFinite(second) || new Date(second).toISOString().slice(0, 19) !== match[1]) return null;
  return BigInt(second) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
}
