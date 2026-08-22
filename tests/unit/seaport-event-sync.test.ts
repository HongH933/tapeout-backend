import { describe, expect, it } from "vitest";
import type pg from "pg";
import type { PublicClient } from "viem";
import { loadConfig } from "../../src/config.js";
import { syncSeaportEvents } from "../../src/jobs/seaport-event-sync.js";

describe("Seaport batch event indexing", () => {
  it("stores every OrderFulfilled log from one transaction once and excludes fees from seller volume", async () => {
    const txHash = `0x${"a".repeat(64)}`; const blockHash = `0x${"b".repeat(64)}`;
    const orderA = `0x${"1".repeat(64)}`; const orderB = `0x${"2".repeat(64)}`;
    const token = "0x2222222222222222222222222222222222222222"; const seller = "0x1111111111111111111111111111111111111111"; const buyer = "0x9999999999999999999999999999999999999999";
    const rows = new Map([[orderA, { order_hash: orderA, offerer: seller, transistors_address: token.toLowerCase(), token_id: "0", seller_unit_price_wei: "10000", taker_fee_per_unit_wei: "100" }], [orderB, { order_hash: orderB, offerer: seller, transistors_address: token.toLowerCase(), token_id: "0", seller_unit_price_wei: "20000", taker_fee_per_unit_wei: "200" }]]);
    const inserted = new Set<string>(); const insertValues: unknown[][] = []; const remainingUpdates: unknown[][] = [];
    const pool = { query: async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith("SELECT block_number")) return { rows: [] };
      if (sql.startsWith("SELECT * FROM seaport_listings")) return { rows: [rows.get(String(values[0]))].filter(Boolean) };
      if (sql.startsWith("INSERT INTO seaport_fills")) { const key = `${values[2]}:${values[3]}`; if (inserted.has(key)) return { rowCount: 0, rows: [] }; inserted.add(key); insertValues.push(values); return { rowCount: 1, rows: [] }; }
      if (sql.startsWith("UPDATE seaport_listings SET remaining_quantity")) { remainingUpdates.push(values); return { rowCount: 1, rows: [] }; }
      return { rowCount: 1, rows: [] };
    } } as unknown as pg.Pool;
    const fulfilled = [
      { args: { orderHash: orderA, recipient: buyer, offer: [{ token, identifier: 0n, amount: 2n }] }, transactionHash: txHash, logIndex: 7, blockNumber: 101n, blockHash },
      { args: { orderHash: orderB, recipient: buyer, offer: [{ token, identifier: 0n, amount: 3n }] }, transactionHash: txHash, logIndex: 8, blockNumber: 101n, blockHash },
    ];
    const client = { getBlockNumber: async () => 101n, getBlock: async () => ({ timestamp: 1_800_000_000n, hash: blockHash }), getContractEvents: async (input: { eventName: string }) => input.eventName === "OrderFulfilled" ? fulfilled : [] } as unknown as PublicClient;
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused", BSC_RPC_HTTP_URL: "http://localhost:8545", FEE_RECIPIENT: "0x3333333333333333333333333333333333333333", SEAPORT_INDEX_START_BLOCK: "101", CHAIN_CONFIRMATIONS: "0", CHAIN_STARTUP_CHECK: "false" });
    expect(await syncSeaportEvents(pool, client, config)).toBe(2);
    expect(inserted).toEqual(new Set([`${txHash}:7`, `${txHash}:8`]));
    expect(insertValues.map((values) => ({ sellerProceeds: values[15], fee: values[16], buyerTotal: values[17] }))).toEqual([{ sellerProceeds: "20000", fee: "200", buyerTotal: "20200" }, { sellerProceeds: "60000", fee: "600", buyerTotal: "60600" }]);
    expect(remainingUpdates).toEqual([[orderA, "2"], [orderB, "3"]]);
    expect(await syncSeaportEvents(pool, client, config)).toBe(0);
    expect(insertValues).toHaveLength(2); expect(remainingUpdates).toHaveLength(2);
  });
});
