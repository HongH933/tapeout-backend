import type { ListingRecord, ListingStatus } from "../domain/listing.js";

export type ListingQuery = { transistorsAddress?: string; tokenId?: string; offerer?: string; statuses?: ListingStatus[]; limit?: number; cursor?: string };
export type ListingValidationPatch = Partial<Pick<ListingRecord, "status" | "remainingQuantity" | "validationState" | "validationDetails" | "validatorCodes" | "lastValidatedAt" | "updatedAt">>;
export type MarketPageQuery = { transistorsAddress: string; tokenId: string; statuses?: ListingStatus[]; limit: number; cursor?: string };
export type MarketPage = { listings: ListingRecord[]; nextCursor: string | null };
export type SweepCandidateQuery = { transistorsAddress: string; tokenId: string; excludeOfferer: string; maxSellerUnitPriceWei: string; statuses: ListingStatus[]; limit: number };
export type MarketCursor = { sellerUnitPriceWei: string; orderHash: string };

export function encodeMarketCursor(cursor: MarketCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeMarketCursor(value: string): MarketCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid cursor");
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.sellerUnitPriceWei !== "string" || !/^\d+$/.test(candidate.sellerUnitPriceWei) || typeof candidate.orderHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(candidate.orderHash)) throw new Error("Invalid cursor");
    return { sellerUnitPriceWei: candidate.sellerUnitPriceWei, orderHash: candidate.orderHash.toLowerCase() };
  } catch (error) {
    throw new Error("INVALID_CURSOR", { cause: error });
  }
}
export type FillRecord = { orderHash: string; txHash: string; logIndex: number; blockNumber: string; blockTimestamp: string; seller: string; buyer: string; transistorsAddress: string; tokenId: string; quantity: string; sellerUnitPriceWei: string; sellerProceedsWei: string; takerFeeWei: string; buyerTotalWei: string; source: "SEAPORT_LISTING_SALE" };
export type MarketSummary = { bestAskWei: string | null; bestAskBuyerTotalWei: string | null; activeListingCount: string; activeListingQuantity: string; lastSeaportSaleWei: string | null; seaportVolume24hWei: string; generatedAt: string };
export interface ListingRepository {
  ready(): Promise<boolean>; get(orderHash: string): Promise<ListingRecord | null>; getMany(orderHashes: string[]): Promise<ListingRecord[]>; insert(listing: ListingRecord): Promise<ListingRecord>;
  list(query: ListingQuery): Promise<ListingRecord[]>; listMarketPage(query: MarketPageQuery): Promise<MarketPage>; listSweepCandidates(query: SweepCandidateQuery): Promise<ListingRecord[]>;
  updateValidation(orderHash: string, patch: ListingValidationPatch): Promise<ListingRecord | null>; revalidateMany(updates: Array<{ orderHash: string; patch: ListingValidationPatch }>): Promise<ListingRecord[]>;
  listFills(transistorsAddress: string, tokenId: string, limit?: number): Promise<FillRecord[]>; summary(transistorsAddress: string, tokenId: string): Promise<MarketSummary>;
  close(): Promise<void>;
}
