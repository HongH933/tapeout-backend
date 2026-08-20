import { describe, expect, it } from "vitest";
import { ZeroAddress, ZeroHash } from "ethers";
import { assertBatchQuoteExpectation, buildSelectedBatchQuote, buildSweepBatchQuote, deterministicPlanHash, type BatchCandidate } from "../../src/domain/batch-quote.js";
import { DomainError } from "../../src/domain/errors.js";
import type { ListingRecord, ListingStatus } from "../../src/domain/listing.js";
import { decodeMarketCursor, encodeMarketCursor } from "../../src/db/repository.js";

const now = new Date("2026-08-21T00:00:00.000Z");
const buyer = "0x9999999999999999999999999999999999999999";
const token = "0x2222222222222222222222222222222222222222";
const processor = "0x4444444444444444444444444444444444444444";
const feeRecipient = "0x3333333333333333333333333333333333333333";
const sellerA = "0x1111111111111111111111111111111111111111";
const sellerB = "0x5555555555555555555555555555555555555555";
const hash = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;

function listing(id: number, price = 10_000n, remaining = 10n, seller = sellerA, status: ListingStatus = "ACTIVE"): ListingRecord {
  const fee = price / 100n; const timestamp = now.toISOString(); const endTime = String(Math.floor(now.getTime() / 1_000) + 3_600);
  return {
    orderHash: hash(id), chainId: 56, seaportAddress: "0x0000000000000068F116a894984e2DB1123eB395", offerer: seller,
    processorAddress: processor, transistorsAddress: token, tokenId: "0", assetType: "NAND", initialQuantity: remaining.toString(), remainingQuantity: remaining.toString(),
    sellerUnitPriceWei: price.toString(), takerFeePerUnitWei: fee.toString(), buyerUnitTotalWei: (price + fee).toString(),
    sellerTotalWei: (price * remaining).toString(), feeTotalWei: (fee * remaining).toString(), buyerTotalWei: ((price + fee) * remaining).toString(),
    parameters: { offerer: seller, zone: ZeroAddress, offer: [{ itemType: 3, token, identifierOrCriteria: "0", startAmount: remaining.toString(), endAmount: remaining.toString() }], consideration: [{ itemType: 0, token: ZeroAddress, identifierOrCriteria: "0", startAmount: (price * remaining).toString(), endAmount: (price * remaining).toString(), recipient: seller }, { itemType: 0, token: ZeroAddress, identifierOrCriteria: "0", startAmount: (fee * remaining).toString(), endAmount: (fee * remaining).toString(), recipient: feeRecipient }], orderType: 1, startTime: "1", endTime, zoneHash: ZeroHash, salt: String(id), conduitKey: ZeroHash, totalOriginalConsiderationItems: "2", counter: "0" },
    signature: "0x12", status, validationState: "SIGNED_OFFCHAIN_VALID", validationDetails: {}, validatorCodes: { errors: [], warnings: [] }, startTime: "1", endTime, createdAt: timestamp, updatedAt: timestamp, lastValidatedAt: timestamp,
  };
}

const candidate = (row: ListingRecord, balance = row.remainingQuantity): BatchCandidate => ({ listing: row, sellerBalance: balance });
const meta = (maxOrders = 20) => ({ chainId: 56, buyer, transistorsAddress: token, tokenId: "0", asOfBlock: "123", ttlSeconds: 15, maxOrders, now });
const code = (callback: () => unknown) => { try { callback(); return null; } catch (error) { return error instanceof DomainError ? error.code : "UNKNOWN"; } };

describe("batch quote planning", () => {
  it("fully covers one listing and includes the 1% fee in budget", () => {
    const quote = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 2n))], 20_200n, 10_000n);
    expect(quote).toMatchObject({ orderCount: 1, totalUnits: "2", sellerSubtotalWei: "20000", takerFeeWei: "200", buyerTotalWei: "20200", unusedBudgetWei: "0" });
  });
  it("covers multiple listings from lowest seller price first", () => {
    const quote = buildSweepBatchQuote(meta(), [candidate(listing(2, 20_000n, 1n, sellerB)), candidate(listing(1, 10_000n, 1n))], 30_300n, 20_000n);
    expect(quote.items.map((item) => item.orderHash)).toEqual([hash(1), hash(2)]);
  });
  it("partially fills the final listing with integer units", () => {
    const quote = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 10n))], 35_000n, 10_000n);
    expect(quote.items[0]?.unitsToFill).toBe("3"); expect(quote.unusedBudgetWei).toBe("4700");
  });
  it("rejects a budget below one buyer unit", () => expect(code(() => buildSweepBatchQuote(meta(), [candidate(listing(1))], 10_099n, 10_000n))).toBe("BUDGET_TOO_LOW"));
  it("honors the maximum seller price", () => {
    const quote = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 1n)), candidate(listing(2, 20_000n, 1n, sellerB))], 50_000n, 10_000n);
    expect(quote.orderCount).toBe(1); expect(quote.nextSellerUnitPriceWei).toBe("20000");
  });
  it("truncates at max orders without creating another transaction", () => {
    const quote = buildSweepBatchQuote(meta(1), [candidate(listing(1, 10_000n, 1n)), candidate(listing(2, 20_000n, 1n, sellerB))], 50_000n, 20_000n);
    expect(quote.truncated).toBe(true); expect(quote.orderCount).toBe(1);
  });
  it("excludes self listings, stale listings and expired listings", () => {
    const expired = listing(3, 10_000n, 1n, sellerB); expired.endTime = "1";
    expect(code(() => buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 1n, buyer)), candidate(listing(2, 10_000n, 1n, sellerA, "STALE")), candidate(expired)], 100_000n, 10_000n))).toBe("BUDGET_TOO_LOW");
  });
  it("fails selected mode instead of replacing an invalid listing", () => expect(code(() => buildSelectedBatchQuote(meta(), [candidate(listing(1, 10_000n, 1n, sellerA, "STALE"))], [{ orderHash: hash(1), quantity: "1" }]))).toBe("LISTING_NOT_FILLABLE"));
  it("aggregates inventory for multiple orders from the same seller", () => {
    const quote = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 8n), "10"), candidate(listing(2, 20_000n, 7n), "10")], 500_000n, 20_000n);
    expect(quote.totalUnits).toBe("10"); expect(quote.items[1]?.unitsToFill).toBe("2");
    expect(code(() => buildSelectedBatchQuote(meta(), [candidate(listing(1, 10_000n, 8n), "10"), candidate(listing(2, 20_000n, 7n), "10")], [{ orderHash: hash(1), quantity: "8" }, { orderHash: hash(2), quantity: "7" }]))).toBe("INSUFFICIENT_SELLER_BALANCE");
  });
  it("keeps seller price fee-exclusive and computes weighted averages", () => {
    const quote = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 2n)), candidate(listing(2, 20_000n, 1n, sellerB))], 40_400n, 20_000n);
    expect(quote.weightedAverageSellerUnitPriceWei).toBe("13333"); expect(quote.weightedAverageBuyerUnitWei).toBe("13466"); expect(quote.sellerSubtotalWei).toBe("40000");
  });
  it("computes price impact entirely with bigint", () => {
    const quote = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 1n)), candidate(listing(2, 15_000n, 1n, sellerB))], 25_250n, 15_000n);
    expect(quote.priceImpactBps).toBe("5000");
  });
  it("creates deterministic plan hashes while quote IDs vary", () => {
    const first = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 1n))], 10_100n, 10_000n); const second = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 1n))], 10_100n, 10_000n);
    expect(first.planHash).toBe(second.planHash); expect(first.quoteId).not.toBe(second.quoteId);
    expect(deterministicPlanHash({ ...meta(), mode: "SWEEP", maxSellerUnitPriceWei: "10000", items: first.items })).toBe(first.planHash);
  });
  it("supports bigint-scale quantities", () => {
    const quantity = 10n ** 30n; const quote = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, quantity))], 10_100n * quantity, 10_000n);
    expect(quote.totalUnits).toBe(quantity.toString());
  });
  it("rejects duplicate selected orders", () => expect(code(() => buildSelectedBatchQuote(meta(), [candidate(listing(1))], [{ orderHash: hash(1), quantity: "1" }, { orderHash: hash(1), quantity: "1" }]))).toBe("BATCH_PLAN_CHANGED"));
  it("uses a stable composite cursor", () => {
    const value = encodeMarketCursor({ sellerUnitPriceWei: "10000", orderHash: hash(9) });
    expect(decodeMarketCursor(value)).toEqual({ sellerUnitPriceWei: "10000", orderHash: hash(9) }); expect(() => decodeMarketCursor("bad")).toThrow("INVALID_CURSOR");
  });
  it("enforces plan change and quote expiry expectations", () => {
    const quote = buildSweepBatchQuote(meta(), [candidate(listing(1, 10_000n, 1n))], 10_100n, 10_000n);
    expect(code(() => assertBatchQuoteExpectation(quote, hash(99)))).toBe("BATCH_PLAN_CHANGED");
    expect(code(() => assertBatchQuoteExpectation(quote, undefined, "2026-08-20T00:00:00.000Z"))).toBe("BATCH_QUOTE_EXPIRED");
    expect(new Date(quote.expiresAt).getTime() - new Date(quote.createdAt).getTime()).toBe(15_000);
  });
});
