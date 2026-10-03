import type { DatabaseSync } from "node:sqlite";
import type { PrivyClient } from "@privy-io/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listOperations, readMarketAccount } from "@/lib/markets/accounts";
import { openCredentials } from "@/lib/markets/credentials";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const venue = vi.hoisted(() => ({
  deployed: false, approvalsReady: false, relayOutcome: "pending" as "pending" | "confirmed",
  deploy: vi.fn(async () => ({ transactionId: "tx-deploy", state: "STATE_NEW", transactionHash: null })),
  submitBatch: vi.fn(async () => ({ transactionId: "tx-batch", state: "STATE_NEW", transactionHash: null })),
  postOrder: vi.fn(async () => ({ orderId: "0xabc", status: "matched", makingAmount: "10", takingAmount: "16.9", tradeIds: [] })),
  sync: vi.fn(async () => undefined)
}));

vi.mock("@/lib/markets/polymarket", async (original) => {
  const actual = await original<typeof import("@/lib/markets/polymarket")>();
  return {
    ...actual,
    isDeployed: async () => venue.deployed,
    deployDepositWallet: venue.deploy,
    relayerTransaction: async (id: string) => ({ transactionId: id, state: "STATE_MINED", outcome: venue.relayOutcome, transactionHash: null, error: null }),
    tradingApprovalsState: async () => ({ ready: venue.approvalsReady, missing: venue.approvalsReady ? [] : actual.approvalCalls() }),
    fetchWalletNonce: async () => "7",
    submitWalletBatch: venue.submitBatch,
    createOrDeriveApiKey: async () => ({ key: "k", secret: "c2VjcmV0", passphrase: "p" }),
    syncClobAllowance: venue.sync,
    builderCode: () => { throw new Error("not configured"); },
    getMarket: async () => ({ id: "12", question: "Will it rain?", conditionId: `0x${"1".repeat(64)}`, closed: false, acceptingOrders: true, negRisk: false,
      tickSize: 0.01, minOrderSize: 5, yesTokenId: "111", noTokenId: "222",
      outcomes: [{ name: "Yes", tokenId: "111", price: 0.59 }, { name: "No", tokenId: "222", price: 0.41 }] }),
    orderBook: async (token: string) => ({ tokenId: token, market: `0x${"1".repeat(64)}`, negRisk: false, tickSize: 0.01, minOrderSize: 5,
      bids: [{ price: 0.58, size: 1000 }], asks: [{ price: 0.59, size: 1000 }], lastTradePrice: 0.59, observedAt: "t", hash: "h" }),
    postOrder: venue.postOrder,
    baseUsdcDepositMinimum: async () => 2,
    depositAddress: async () => "0x5555555555555555555555555555555555555555"
  };
});

const { buildPredictionsDeposit, completePredictionsSignature, startPredictionBuy, startPredictionsSetup } = await import("@/lib/markets/predictions");

const now = new Date("2026-10-03T12:00:00.000Z");
const owner = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8" as const;
const account = { address: owner, walletId: "owner-wallet" };
const secret = Buffer.alloc(32, 3).toString("base64");
let sqlite: DatabaseSync;
let db: D1Database;
// The relay returns whatever signature the test's Privy fake makes; signatures are checked by the venue library, mocked here.
const signature = `0x${"ab".repeat(64)}1b`;
const privy = { wallets: () => ({ rpc: async () => ({ data: { signature } }) }) } as unknown as PrivyClient;
const deps = { privy, now: () => now, secret };

beforeEach(() => {
  sqlite = schemaDatabase();
  sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');`);
  db = d1(sqlite);
  Object.assign(venue, { deployed: false, approvalsReady: false, relayOutcome: "pending" });
  vi.stubEnv("PRIVY_APP_SECRET", "test-secret");
});
afterEach(() => { sqlite.close(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

async function connect() {
  Object.assign(venue, { deployed: true, approvalsReady: true });
  const step = await startPredictionsSetup(db, "alice", account, deps);
  if (step.status !== "sign") throw new Error("expected sign-in");
  await completePredictionsSignature(db, "alice", account, step.requestId, "auth", deps);
}

describe("connecting a wallet to Polymarket", () => {
  it("deploys the deposit wallet, has the owner approve and sign in, then keeps the key sealed", async () => {
    const first = await startPredictionsSetup(db, "alice", account, deps);
    expect(first).toMatchObject({ status: "waiting", transactionId: "tx-deploy" });
    // While the deployment is on its way, nothing else is asked.
    expect(await startPredictionsSetup(db, "alice", account, deps)).toMatchObject({ status: "waiting", transactionId: "tx-deploy" });
    expect(venue.deploy).toHaveBeenCalledTimes(1);

    Object.assign(venue, { deployed: true, relayOutcome: "confirmed" });
    const approvals = await startPredictionsSetup(db, "alice", account, deps);
    if (approvals.status !== "sign") throw new Error("expected approvals");
    expect(approvals.request.body.params.typed_data).toMatchObject({ primary_type: "Batch", message: { nonce: "7" } });
    expect(await completePredictionsSignature(db, "alice", account, approvals.requestId, "auth", deps))
      .toEqual({ status: "submitted", kind: "setup", transactionId: "tx-batch" });

    venue.approvalsReady = true;
    const signIn = await startPredictionsSetup(db, "alice", account, deps);
    if (signIn.status !== "sign") throw new Error("expected sign-in");
    expect(signIn.request.body.params.typed_data.primary_type).toBe("ClobAuth");
    expect(await completePredictionsSignature(db, "alice", account, signIn.requestId, "auth", deps)).toEqual({ status: "accepted", kind: "setup" });
    expect(venue.sync).toHaveBeenCalledWith(expect.objectContaining({ ownerAddress: owner }), { type: "COLLATERAL" }, expect.anything());
    const stored = await readMarketAccount(db, "alice", "polymarket", owner);
    expect(stored).toMatchObject({ status: "ready" });
    expect(stored!.credentialsCiphertext).not.toContain("c2VjcmV0");
    expect(await openCredentials(stored!.credentialsCiphertext!, "alice:polymarket", secret)).toEqual({ key: "k", secret: "c2VjcmV0", passphrase: "p" });
    expect((await startPredictionsSetup(db, "alice", account, deps)).status).toBe("ready");
  });
});

describe("trading an outcome", () => {
  it("refuses before the wallet is connected", async () => {
    await expect(startPredictionBuy(db, "alice", account, { marketId: "12", outcome: 0, amountUsd: 10 }, deps))
      .rejects.toMatchObject({ code: "predictions_not_connected" });
  });

  it("prices a dollar buy, has the owner sign the exact order, and posts it", async () => {
    await connect();
    const buy = await startPredictionBuy(db, "alice", account, { marketId: "12", outcome: 0, amountUsd: 10 }, deps);
    expect(buy.quote.estimatedShares).toBeCloseTo(16.94, 1);
    expect(buy.quote.payoutIfWins).toBe(buy.quote.estimatedShares);
    expect(buy.request.body.params.typed_data.primary_type).toBe("TypedDataSign");
    const done = await completePredictionsSignature(db, "alice", account, buy.requestId, "auth", deps);
    expect(done).toMatchObject({ status: "accepted", kind: "order", order: { orderId: "0xabc" } });
    expect(venue.postOrder).toHaveBeenCalledWith(expect.objectContaining({ signature: signature.toLowerCase() }), expect.anything());
    expect((await listOperations(db, "alice", "polymarket")).find((item) => item.kind === "order")).toMatchObject({ kind: "order", status: "accepted", externalId: "0xabc" });
  });
});

describe("adding money", () => {
  it("sends Base USDC to the wallet's own bridge address, outside the daily limit", async () => {
    await connect();
    const built = await buildPredictionsDeposit(db, "alice", owner, "25", deps);
    expect(built).toMatchObject({ kind: "transfer", chainId: 8453, countsTowardLimit: false,
      effects: [{ type: "erc20_transfer", to: "0x5555555555555555555555555555555555555555", amountRaw: "25000000" }],
      summary: { market: "polymarket" } });
    expect(built.recipient).toBeUndefined();
    await expect(buildPredictionsDeposit(db, "alice", owner, "1", deps)).rejects.toMatchObject({ code: "amount_too_small" });
  });
});
