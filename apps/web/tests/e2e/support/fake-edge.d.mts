export const APP_ID: string;
export const SKY_RATE: readonly [bigint, bigint];
export function aTokenFor(underlying: string): `0x${string}`;
export function startFakeEdge(options: { port: number }): Promise<{
  verificationKey: string;
  secret: string;
  vars: Record<string, string>;
  close: () => Promise<void>;
}>;
