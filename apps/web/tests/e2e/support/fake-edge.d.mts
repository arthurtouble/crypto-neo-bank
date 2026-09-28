export const APP_ID: string;
export const OPERATOR: { email: string; audience: string };
export const LIFI_DIAMOND: `0x${string}`;
export const ENTRY_POINT: `0x${string}`;
export const BRIDGE: { sender: `0x${string}`; payoutDeposit: `0x${string}`; cardsSpender: `0x${string}` };
export const FEEDS: { apple: string; gold: string; euro: string };
export const AAVE_POOL: string;
export const VAULTS: { steakhouse: string; gauntlet: string };
export function aTokenFor(underlying: string): `0x${string}`;
export function startFakeEdge(options: { port: number }): Promise<{
  verificationKey: string;
  url: string;
  secret: string;
  vars: Record<string, string>;
  close: () => Promise<void>;
}>;
