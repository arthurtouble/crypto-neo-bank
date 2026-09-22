import { getAddress, isAddress, type Address, type Hex } from "viem";

export type UnsignedPlanTransaction = { to: `0x${string}`; data?: `0x${string}`; value?: bigint; chainId: number };

export type SimulationRequest = { account: Address; to: Address; data?: Hex; value: bigint };

export function toSimulationRequest(transaction: UnsignedPlanTransaction, account: string): SimulationRequest {
  return {
    account: getAddress(account),
    to: getAddress(transaction.to),
    data: transaction.data,
    value: transaction.value ?? 0n
  };
}

export function collectUnsignedTransactions(value: unknown, expectedChainId: number): UnsignedPlanTransaction[] {
  const output: UnsignedPlanTransaction[] = [];
  const seen = new Set<string>();
  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const record = node as Record<string, unknown>;
    if (typeof record.to === "string" && isAddress(record.to) && (record.data === undefined || typeof record.data === "string")) {
      const key = `${record.to}:${String(record.data ?? "0x")}:${String(record.value ?? "0")}`;
      if (!seen.has(key)) {
        seen.add(key);
        output.push({
          to: record.to,
          data: typeof record.data === "string" && record.data.startsWith("0x") ? record.data as `0x${string}` : undefined,
          value: record.value === undefined ? undefined : BigInt(String(record.value)),
          chainId: typeof record.chainId === "number" ? record.chainId : expectedChainId
        });
      }
      return;
    }
    for (const key of ["approval", "transaction", "originalTransaction", "transactions", "plan", "data", "v3", "v4"]) if (key in record) visit(record[key]);
  }
  visit(value);
  return output.filter((transaction) => transaction.chainId === expectedChainId);
}

export function findStringField(value: unknown, names: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findStringField(item, names); if (found) return found; }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const name of names) if (typeof record[name] === "string") return record[name];
  for (const child of Object.values(record)) { const found = findStringField(child, names); if (found) return found; }
  return undefined;
}

export function collectWarnings(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(collectWarnings);
  const record = value as Record<string, unknown>;
  const own = Array.isArray(record.warnings) ? record.warnings.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).message === "string") return [(item as Record<string, unknown>).message as string];
    return [];
  }) : [];
  return [...own, ...Object.entries(record).filter(([key]) => key !== "warnings").flatMap(([, child]) => collectWarnings(child))];
}
