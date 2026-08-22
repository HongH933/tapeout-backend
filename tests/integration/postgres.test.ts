import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";
import type { PublicClient } from "viem";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import type { ListingRecord } from "../../src/domain/listing.js";
import { PostgresListingRepository } from "../../src/db/postgres-repository.js";

const processor = "0x4444444444444444444444444444444444444444";
const token = "0x2222222222222222222222222222222222222222";
const offerer = "0x1111111111111111111111111111111111111111";
const fee = "0x3333333333333333333333333333333333333333";

describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL migration", () => {
  it("applies the production migration and exposes every required table", async () => { const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL! }); try { await pool.query(await readFile(new URL("../../migrations/0001_initial.sql", import.meta.url), "utf8")); await pool.query(await readFile(new URL("../../migrations/0002_circuit_listings.sql", import.meta.url), "utf8")); const result = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'"); const tables = result.rows.map((row) => row.tablename); expect(tables).toEqual(expect.arrayContaining(["processors", "assets", "seaport_listings", "seaport_fills", "sync_checkpoints"])); const columns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='seaport_listings'"); expect(columns.rows.map((row) => row.column_name)).toEqual(expect.arrayContaining(["asset_standard", "collection_address"])); } finally { await pool.end(); } });
  it("keeps existing rows, hashes and signatures unchanged across capacity and batch-summary reads", async () => {
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL!, max: 1 });
    await pool.query(await readFile(new URL("../../migrations/0001_initial.sql", import.meta.url), "utf8"));
    await pool.query(await readFile(new URL("../../migrations/0002_circuit_listings.sql", import.meta.url), "utf8"));
    await pool.query("BEGIN");
    const now = Math.floor(Date.now() / 1_000); const orderHash = `0x${"9".repeat(64)}`; const signature = "0x1234";
    const parameters = { offerer, zone: "0x0000000000000000000000000000000000000000", offer: [{ itemType: 3, token, identifierOrCriteria: "0", startAmount: "200", endAmount: "200" }], consideration: [{ itemType: 0, token: "0x0000000000000000000000000000000000000000", identifierOrCriteria: "0", startAmount: "20000", endAmount: "20000", recipient: offerer }, { itemType: 0, token: "0x0000000000000000000000000000000000000000", identifierOrCriteria: "0", startAmount: "200", endAmount: "200", recipient: fee }], orderType: 1, startTime: String(now - 10), endTime: String(now + 86_400), zoneHash: `0x${"0".repeat(64)}`, salt: "99", conduitKey: `0x${"0".repeat(64)}`, totalOriginalConsiderationItems: "2", counter: "0" };
    const listing: ListingRecord = { orderHash, chainId: 56, seaportAddress: "0x0000000000000068F116a894984e2DB1123eB395", processorAddress: processor, assetStandard: "ERC1155", collectionAddress: token, transistorsAddress: token, tokenId: "0", assetType: "NAND", initialQuantity: "200", remainingQuantity: "200", sellerUnitPriceWei: "100", takerFeePerUnitWei: "1", buyerUnitTotalWei: "101", sellerTotalWei: "20000", feeTotalWei: "200", buyerTotalWei: "20200", offerer, parameters, signature, status: "ACTIVE", validationState: "SIGNED_OFFCHAIN_VALID", validationDetails: {}, validatorCodes: { errors: [], warnings: [] }, startTime: parameters.startTime, endTime: parameters.endTime, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastValidatedAt: new Date().toISOString() };
    const repository = new PostgresListingRepository(pool); await repository.insert(listing);
    await pool.query("INSERT INTO seaport_fills(chain_id,order_hash,tx_hash,log_index,block_number,block_hash,block_timestamp,seller,buyer,transistors_address,token_id,quantity,seller_unit_price_wei,seller_proceeds_wei,taker_fee_wei,buyer_total_wei) VALUES(56,$1,$2,10,123,$3,now(),$4,$5,$6,0,2,100,200,2,202)", [orderHash, `0x${"8".repeat(64)}`, `0x${"7".repeat(64)}`, offerer, "0x5555555555555555555555555555555555555555", token]);
    const before = (await pool.query("SELECT (SELECT count(*) FROM seaport_listings) listing_count,(SELECT count(*) FROM seaport_fills) fill_count,(SELECT order_hash FROM seaport_listings WHERE order_hash=$1) order_hash,(SELECT signature FROM seaport_listings WHERE order_hash=$1) signature", [orderHash])).rows[0];
    const chainClient = { getBlockNumber: async () => 123n, readContract: async ({ functionName }: any) => { if (functionName === "circuits") return processor; if (functionName === "transistors") return token; if (functionName === "isCPU" || functionName === "supportsInterface") return true; if (functionName === "balanceOf") return 500n; throw new Error(`Unexpected ${functionName}`); } } as unknown as PublicClient;
    const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: process.env.TEST_DATABASE_URL!, BSC_RPC_HTTP_URL: "http://localhost:8545", FEE_RECIPIENT: fee, CHAIN_STARTUP_CHECK: "false" });
    const app = await buildApp({ config, repository, chainClient });
    const capacity = await app.inject({ method: "GET", url: `/api/v1/accounts/${offerer}/markets/${token}/0/listing-capacity` }); expect(capacity.statusCode).toBe(200); expect(capacity.json()).toMatchObject({ walletBalance: "500", reservedListingQuantity: "200", availableToList: "300" });
    const summaries = await app.inject({ method: "POST", url: "/api/v1/markets/summaries", payload: { markets: [{ transistorsAddress: token, tokenId: "0" }] } }); expect(summaries.statusCode).toBe(200); expect(summaries.json().summaries[0]).toMatchObject({ seaportVolume24hWei: "200", seaportVolumeAllTimeWei: "200", seaportFillCount24h: "1" });
    const after = (await pool.query("SELECT (SELECT count(*) FROM seaport_listings) listing_count,(SELECT count(*) FROM seaport_fills) fill_count,(SELECT order_hash FROM seaport_listings WHERE order_hash=$1) order_hash,(SELECT signature FROM seaport_listings WHERE order_hash=$1) signature", [orderHash])).rows[0];
    expect(after).toEqual(before);
    await pool.query("ROLLBACK"); await app.close();
  });
});
