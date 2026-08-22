import { describe, expect, it } from "vitest";
import type pg from "pg";
import type { PublicClient } from "viem";
import { loadConfig } from "../../src/config.js";
import { syncSeaportEvents } from "../../src/jobs/seaport-event-sync.js";

describe("BEM OrderFulfilled indexing", () => {
  it("uses listing semantics and explicit USDT recipients, excluding fee from volume fields", async () => {
    const orderHash = `0x${"1".repeat(64)}`; const txHash = `0x${"a".repeat(64)}`; const blockHash = `0x${"b".repeat(64)}`;
    const seller = "0x1111111111111111111111111111111111111111"; const buyer = "0x9999999999999999999999999999999999999999"; const feeRecipient = "0x3333333333333333333333333333333333333333";
    const bem = "0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a"; const usdt = "0x55d398326f99059ff775485246999027b3197955";
    const inserts: unknown[][] = []; const updates: unknown[][] = [];
    const pool = { query: async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith("SELECT block_number")) return { rows: [] };
      if (sql.startsWith("SELECT * FROM seaport_listings")) return { rows: [{ order_hash: orderHash, offerer: seller, asset_standard: "ERC20", collection_address: bem, transistors_address: null, token_id: "0", initial_quantity: "100", seller_quote_total_atomic: "100", fee_quote_total_atomic: "1", unit_price_quote_atomic: "1" }] };
      if (sql.startsWith("INSERT INTO seaport_fills")) { inserts.push(values); return { rowCount: 1, rows: [] }; }
      if (sql.startsWith("UPDATE seaport_listings SET remaining_quantity")) { updates.push(values); return { rowCount: 1, rows: [] }; }
      return { rowCount: 1, rows: [] };
    } } as unknown as pg.Pool;
    const fulfilled = [{ args: { orderHash, recipient: buyer, offer: [{ token: bem, identifier: 0n, amount: 100n }], consideration: [{ token: usdt, identifier: 0n, amount: 100n, recipient: seller }, { token: usdt, identifier: 0n, amount: 1n, recipient: feeRecipient }] }, transactionHash: txHash, logIndex: 5, blockNumber: 101n, blockHash }];
    const client = { getBlockNumber: async () => 101n, getBlock: async () => ({ timestamp: 1_800_000_000n, hash: blockHash }), getContractEvents: async (input: { eventName: string }) => input.eventName === "OrderFulfilled" ? fulfilled : [] } as unknown as PublicClient;
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused", BSC_RPC_HTTP_URL: "http://localhost:8545", FEE_RECIPIENT: feeRecipient, SEAPORT_INDEX_START_BLOCK: "101", CHAIN_CONFIRMATIONS: "0", CHAIN_STARTUP_CHECK: "false" });
    expect(await syncSeaportEvents(pool, client, config)).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.slice(18, 24)).toEqual(["BEM_USDT", "100", "100", "1", "101", "1"]);
    expect(updates).toEqual([[orderHash, "100"]]);
  });
});
