import { describe, expect, it } from "vitest";
import { Wallet, ZeroAddress, ZeroHash } from "ethers";
import type { PublicClient } from "viem";
import { buildApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import type { ListingRecord } from "../../src/domain/listing.js";
import type { ListingQuery, ListingRepository } from "../../src/db/repository.js";
import { ORDER_TYPES } from "../../src/domain/signature.js";

const processor = "0x4444444444444444444444444444444444444444"; const token = "0x2222222222222222222222222222222222222222"; const fee = "0x3333333333333333333333333333333333333333";
class MemoryTestRepository implements ListingRepository {
  rows = new Map<string, ListingRecord>(); async ready() { return true; } async get(hash: string) { return this.rows.get(hash.toLowerCase()) ?? null; }
  async insert(row: ListingRecord) { this.rows.set(row.orderHash.toLowerCase(), row); return row; }
  async list(q: ListingQuery) { return [...this.rows.values()].filter((r) => (!q.transistorsAddress || r.transistorsAddress.toLowerCase() === q.transistorsAddress.toLowerCase()) && (!q.tokenId || r.tokenId === q.tokenId) && (!q.offerer || r.offerer.toLowerCase() === q.offerer.toLowerCase()) && (!q.statuses || q.statuses.includes(r.status))).slice(0, q.limit ?? 50); }
  async updateValidation(hash: string, patch: Partial<ListingRecord>) { const row = await this.get(hash); if (!row) return null; const next = { ...row, ...patch }; this.rows.set(hash.toLowerCase(), next); return next; } async close() {}
  async listFills() { return []; }
  async summary(transistorsAddress: string, tokenId: string) { const rows = await this.list({ transistorsAddress, tokenId, statuses: ["ACTIVE", "PARTIALLY_FILLED"] }); return { bestAskWei: rows[0]?.sellerUnitPriceWei ?? null, bestAskBuyerTotalWei: rows[0]?.buyerUnitTotalWei ?? null, activeListingCount: String(rows.length), activeListingQuantity: rows.reduce((sum, row) => sum + BigInt(row.remainingQuantity), 0n).toString(), lastSeaportSaleWei: null, seaportVolume24hWei: "0", generatedAt: new Date().toISOString() }; }
}
function fakeClient(wallet: string): PublicClient {
  return { getCode: async ({ address }: any) => address.toLowerCase() === wallet.toLowerCase() ? "0x" : "0x6000", readContract: async ({ functionName }: any) => {
    if (functionName === "isCPU" || functionName === "supportsInterface" || functionName === "isApprovedForAll") return true;
    if (functionName === "transistors") return token; if (functionName === "circuits") return processor; if (functionName === "balanceOf") return 100n;
    if (functionName === "getCounter") return 0n; if (functionName === "getOrderStatus") return [false, false, 0n, 0n];
    if (functionName === "isValidOrderWithConfiguration") return { errors: [], warnings: [] }; throw new Error(`Unexpected ${functionName}`);
  } } as unknown as PublicClient;
}
describe("API v1 listing lifecycle", () => {
  it("quotes, validates, stores idempotently, queries and revalidates", async () => {
    const wallet = Wallet.createRandom(); const now = Math.floor(Date.now() / 1000); const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused", BSC_RPC_HTTP_URL: "http://localhost:8545", FEE_RECIPIENT: fee, CHAIN_STARTUP_CHECK: "false" }); const repository = new MemoryTestRepository(); const app = await buildApp({ config, repository, chainClient: fakeClient(wallet.address) });
    const quote = await app.inject({ method: "POST", url: "/api/v1/listings/quote", payload: { processorAddress: processor, transistorsAddress: token, tokenId: "0", sellerUnitPriceWei: "10000", quantity: "10", endTime: String(now + 604800) } }); expect(quote.statusCode).toBe(200); expect(quote.json().buyerTotalWei).toBe("101000");
    const parameters = { offerer: wallet.address, zone: ZeroAddress, offer: [{ itemType: 3, token, identifierOrCriteria: "0", startAmount: "10", endAmount: "10" }], consideration: [{ itemType: 0, token: ZeroAddress, identifierOrCriteria: "0", startAmount: "100000", endAmount: "100000", recipient: wallet.address }, { itemType: 0, token: ZeroAddress, identifierOrCriteria: "0", startAmount: "1000", endAmount: "1000", recipient: fee }], orderType: 1, startTime: String(now - 10), endTime: String(now + 604800), zoneHash: ZeroHash, salt: "1", conduitKey: ZeroHash, totalOriginalConsiderationItems: "2", counter: "0" };
    const signature = await wallet.signTypedData({ name: "Seaport", version: "1.6", chainId: 56, verifyingContract: config.seaportAddress }, ORDER_TYPES, parameters); const payload = { processorAddress: processor, parameters, signature };
    const created = await app.inject({ method: "POST", url: "/api/v1/listings", payload }); expect(created.statusCode).toBe(201); const listing = created.json(); expect(listing.status).toBe("ACTIVE"); expect(listing.validatorCodes.errors).toEqual([]);
    const duplicate = await app.inject({ method: "POST", url: "/api/v1/listings", payload: { ...payload, orderHash: listing.orderHash } }); expect(duplicate.statusCode).toBe(200); expect(repository.rows.size).toBe(1);
    expect((await app.inject({ method: "GET", url: `/api/v1/markets/${token}/0/listings` })).json().listings).toHaveLength(1); expect((await app.inject({ method: "GET", url: `/api/v1/accounts/${wallet.address}/listings` })).json().listings).toHaveLength(1);
    expect((await app.inject({ method: "POST", url: `/api/v1/listings/${listing.orderHash}/revalidate` })).json().status).toBe("ACTIVE"); await app.close();
  });
  it("keeps writes disabled without a fee recipient", async () => { const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://unused", BSC_RPC_HTTP_URL: "http://localhost:8545", CHAIN_STARTUP_CHECK: "false" }); const app = await buildApp({ config, repository: new MemoryTestRepository(), chainClient: fakeClient(ZeroAddress) }); expect((await app.inject({ method: "POST", url: "/api/v1/listings/quote", payload: {} })).statusCode).toBe(503); await app.close(); });
});
