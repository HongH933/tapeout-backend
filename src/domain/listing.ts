export const LISTING_STATUSES = ["PENDING_VALIDATION", "ACTIVE", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED", "INVALID_BALANCE", "INVALID_OWNER", "INVALID_APPROVAL", "INVALID_COUNTER", "INVALID_SIGNATURE", "INVALID_STRUCTURE", "INVALID_ASSET", "STALE", "REJECTED"] as const;
export type ListingStatus = typeof LISTING_STATUSES[number];
export const RESERVING_LISTING_STATUSES = ["PENDING_VALIDATION", "ACTIVE", "PARTIALLY_FILLED", "STALE", "INVALID_BALANCE", "INVALID_APPROVAL"] as const satisfies readonly ListingStatus[];
export const CIRCUIT_RESERVING_LISTING_STATUSES = ["PENDING_VALIDATION", "ACTIVE", "STALE", "INVALID_APPROVAL"] as const satisfies readonly ListingStatus[];

export type AssetStandard = "ERC1155" | "ERC721";
export type MarketplaceAssetType = "NAND" | "LATCH" | "CIRCUIT";
export type MarketplaceAsset = {
  chainId: number;
  standard: AssetStandard;
  collectionAddress: string;
  tokenId: string;
  assetType: MarketplaceAssetType;
  processorAddress: string;
};

export type OfferItem = { itemType: number; token: string; identifierOrCriteria: string; startAmount: string; endAmount: string };
export type ConsiderationItem = OfferItem & { recipient: string };
export type OrderParameters = {
  offerer: string; zone: string; offer: OfferItem[]; consideration: ConsiderationItem[]; orderType: number;
  startTime: string; endTime: string; zoneHash: string; salt: string; conduitKey: string;
  totalOriginalConsiderationItems: string; counter: string;
};
export type SignedListingInput = { assetStandard?: AssetStandard; processorAddress: string; collectionAddress?: string; parameters: OrderParameters; signature: string; orderHash?: string };
export type ListingRecord = {
  orderHash: string; chainId: number; seaportAddress: string; processorAddress: string; assetStandard: AssetStandard;
  collectionAddress: string; transistorsAddress: string | null;
  tokenId: string; assetType: MarketplaceAssetType; initialQuantity: string; remainingQuantity: string;
  sellerUnitPriceWei: string; takerFeePerUnitWei: string; buyerUnitTotalWei: string;
  sellerTotalWei: string; feeTotalWei: string; buyerTotalWei: string; offerer: string;
  parameters: OrderParameters; signature: string; status: ListingStatus; validationState: string;
  validationDetails: unknown; validatorCodes: { errors: number[]; warnings: number[] };
  startTime: string; endTime: string; createdAt: string; updatedAt: string; lastValidatedAt: string;
};

export function isCircuitListing(listing: Pick<ListingRecord, "assetStandard">): listing is ListingRecord & { assetStandard: "ERC721"; assetType: "CIRCUIT"; transistorsAddress: null } {
  return listing.assetStandard === "ERC721";
}

export function isErc1155Listing(listing: Pick<ListingRecord, "assetStandard">): listing is ListingRecord & { assetStandard: "ERC1155"; assetType: "NAND" | "LATCH"; transistorsAddress: string } {
  return listing.assetStandard === "ERC1155";
}
