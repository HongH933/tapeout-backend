import type { ListingRecord, ListingStatus } from "../domain/listing.js";
import { DomainError } from "../domain/errors.js";

export type ListingQuery = { assetStandard?: "ERC1155" | "ERC721" | "ERC20"; collectionAddress?: string; transistorsAddress?: string; tokenId?: string; offerer?: string; statuses?: ListingStatus[]; limit?: number; cursor?: string };
export type ListingValidationPatch = Partial<Pick<ListingRecord, "status" | "remainingQuantity" | "baseAmountRemaining" | "validationState" | "validationDetails" | "validatorCodes" | "lastValidatedAt" | "updatedAt">>;
export type MarketPageQuery = { transistorsAddress: string; tokenId: string; statuses?: ListingStatus[]; limit: number; cursor?: string };
export type MarketPage = { listings: ListingRecord[]; nextCursor: string | null };
export type SweepCandidateQuery = { transistorsAddress: string; tokenId: string; excludeOfferer: string; maxSellerUnitPriceWei: string; statuses: ListingStatus[]; limit: number };
export type MarketCursor = { sellerUnitPriceWei: string; orderHash: string };
export type ListingCapacityKey = { offerer: string; transistorsAddress: string; tokenId: string; nowSeconds?: string };
export type CircuitListingCapacityKey = { offerer: string; collectionAddress: string; tokenId: string; nowSeconds?: string };
export type ListingCapacity = {
  walletBalance: string; reservedListingQuantity: string; availableToList: string;
  overcommittedQuantity: string; reservingListingCount: number;
};
export type InsertWithCapacityCheckInput = { listing: ListingRecord; walletBalance: string; nowSeconds?: string; readCurrentOwner?: () => Promise<string> };
export type MarketIdentity = { transistorsAddress: string; tokenId: string };

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
  } catch {
    throw new DomainError("INVALID_CURSOR", "INVALID_CURSOR", 400);
  }
}
export type FillRecord = { orderHash: string; txHash: string; logIndex: number; blockNumber: string; blockTimestamp: string; seller: string; buyer: string; assetStandard: "ERC1155" | "ERC721"; collectionAddress: string; transistorsAddress: string | null; tokenId: string; quantity: string; sellerUnitPriceWei: string; sellerProceedsWei: string; takerFeeWei: string; buyerTotalWei: string; source: "SEAPORT_LISTING_SALE" };
export type MarketSummary = {
  transistorsAddress: string; tokenId: string; bestAskWei: string | null; bestAskBuyerTotalWei: string | null;
  activeListingCount: string; activeListingQuantity: string; lastSeaportSaleWei: string | null;
  lastSeaportSaleAt: string | null; lastSeaportSaleTxHash: string | null;
  seaportVolume24hWei: string; seaportVolumeAllTimeWei: string; seaportFillCount24h: string;
};
export type MarketSummaries = { summaries: MarketSummary[]; generatedAt: string; lastIndexedBlock: string | null; indexerStale: boolean };
export interface ListingRepository {
  ready(): Promise<boolean>; get(orderHash: string): Promise<ListingRecord | null>; getMany(orderHashes: string[]): Promise<ListingRecord[]>; insert(listing: ListingRecord): Promise<ListingRecord>;
  getReservedListingQuantity(input: ListingCapacityKey): Promise<string>; getListingCapacity(input: ListingCapacityKey & { walletBalance: string }): Promise<ListingCapacity>;
  getCircuitListingCapacity(input: CircuitListingCapacityKey & { currentOwner: string }): Promise<ListingCapacity>;
  insertWithCapacityCheck(input: InsertWithCapacityCheckInput): Promise<ListingRecord>;
  list(query: ListingQuery): Promise<ListingRecord[]>; listMarketPage(query: MarketPageQuery): Promise<MarketPage>; listSweepCandidates(query: SweepCandidateQuery): Promise<ListingRecord[]>;
  updateValidation(orderHash: string, patch: ListingValidationPatch): Promise<ListingRecord | null>; revalidateMany(updates: Array<{ orderHash: string; patch: ListingValidationPatch }>): Promise<ListingRecord[]>;
  listFills(transistorsAddress: string, tokenId: string, limit?: number): Promise<FillRecord[]>; summary(transistorsAddress: string, tokenId: string): Promise<MarketSummary>;
  summaries(markets: MarketIdentity[]): Promise<MarketSummaries>;
  listCircuitPage(input: { collectionAddress: string; tokenId?: string; statuses?: ListingStatus[]; limit: number; cursor?: string; sort?: "price_asc" | "newest" }): Promise<MarketPage>;
  listCircuitFills(collectionAddress: string, tokenId?: string, limit?: number): Promise<FillRecord[]>;
  circuitSummaries(collections: string[]): Promise<{ summaries: Array<{ collectionAddress: string; bestAskWei: string | null; bestAskBuyerTotalWei: string | null; activeListingCount: string; lastSaleWei: string | null; lastSaleAt: string | null; lastSaleTxHash: string | null; volume24hWei: string; volumeAllTimeWei: string; fillCount24h: string; indexedSaleCount: string }>; generatedAt: string; lastIndexedBlock: string | null; indexerStale: boolean }>;
  getBemListingCapacity?(input: { offerer: string; walletBalance: string; nowSeconds?: string }): Promise<ListingCapacity>;
  listBemPage?(input: { statuses?: ListingStatus[]; limit: number; cursor?: string; sort?: "price_asc" | "newest" }): Promise<MarketPage>;
  listBemFills?(limit?: number): Promise<unknown[]>;
  bemSummary?(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
