import type { ListingRecord, ListingStatus } from "../domain/listing.js";

export type ListingQuery = { transistorsAddress?: string; tokenId?: string; offerer?: string; statuses?: ListingStatus[]; limit?: number; cursor?: string };
export type FillRecord = { orderHash: string; txHash: string; logIndex: number; blockNumber: string; blockTimestamp: string; seller: string; buyer: string; transistorsAddress: string; tokenId: string; quantity: string; sellerUnitPriceWei: string; sellerProceedsWei: string; takerFeeWei: string; buyerTotalWei: string; source: "SEAPORT_LISTING_SALE" };
export type MarketSummary = { bestAskWei: string | null; bestAskBuyerTotalWei: string | null; activeListingCount: string; activeListingQuantity: string; lastSeaportSaleWei: string | null; seaportVolume24hWei: string; generatedAt: string };
export interface ListingRepository {
  ready(): Promise<boolean>; get(orderHash: string): Promise<ListingRecord | null>; insert(listing: ListingRecord): Promise<ListingRecord>;
  list(query: ListingQuery): Promise<ListingRecord[]>; updateValidation(orderHash: string, patch: Partial<Pick<ListingRecord, "status" | "remainingQuantity" | "validationState" | "validationDetails" | "validatorCodes" | "lastValidatedAt" | "updatedAt">>): Promise<ListingRecord | null>;
  listFills(transistorsAddress: string, tokenId: string, limit?: number): Promise<FillRecord[]>; summary(transistorsAddress: string, tokenId: string): Promise<MarketSummary>;
  close(): Promise<void>;
}
