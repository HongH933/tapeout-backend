export const LISTING_STATUSES = ["PENDING_VALIDATION", "ACTIVE", "PARTIALLY_FILLED", "FILLED", "CANCELLED", "EXPIRED", "INVALID_BALANCE", "INVALID_OWNER", "INVALID_APPROVAL", "INVALID_COUNTER", "INVALID_SIGNATURE", "INVALID_STRUCTURE", "INVALID_ASSET", "STALE", "REJECTED"] as const;
export type ListingStatus = typeof LISTING_STATUSES[number];
export const RESERVING_LISTING_STATUSES = ["PENDING_VALIDATION", "ACTIVE", "PARTIALLY_FILLED", "STALE", "INVALID_BALANCE", "INVALID_APPROVAL"] as const satisfies readonly ListingStatus[];
export const CIRCUIT_RESERVING_LISTING_STATUSES = ["PENDING_VALIDATION", "ACTIVE", "STALE", "INVALID_OWNER", "INVALID_APPROVAL"] as const satisfies readonly ListingStatus[];

export type AssetStandard = "ERC1155" | "ERC721" | "ERC20";
export type MarketplaceAssetType = "NAND" | "LATCH" | "CIRCUIT" | "BEM";
export type MarketPair = "BEM_USDT";
export type OrderSide = "ASK";
export type MarketplaceAsset = {
  chainId: number;
  standard: AssetStandard;
  collectionAddress: string;
  tokenId: string;
  assetType: MarketplaceAssetType;
  processorAddress: string | null;
};

export type OfferItem = { itemType: number; token: string; identifierOrCriteria: string; startAmount: string; endAmount: string };
export type ConsiderationItem = OfferItem & { recipient: string };
export type OrderParameters = {
  offerer: string; zone: string; offer: OfferItem[]; consideration: ConsiderationItem[]; orderType: number;
  startTime: string; endTime: string; zoneHash: string; salt: string; conduitKey: string;
  totalOriginalConsiderationItems: string; counter: string;
};
export type SignedListingInput = { assetStandard?: AssetStandard; processorAddress?: string | null; collectionAddress?: string; marketPair?: MarketPair; orderSide?: OrderSide; parameters: OrderParameters; signature: string; orderHash?: string };
export type ListingRecord = {
  orderHash: string; chainId: number; seaportAddress: string; processorAddress: string | null; assetStandard: AssetStandard;
  collectionAddress: string; transistorsAddress: string | null;
  tokenId: string; assetType: MarketplaceAssetType; initialQuantity: string; remainingQuantity: string;
  sellerUnitPriceWei: string; takerFeePerUnitWei: string; buyerUnitTotalWei: string;
  sellerTotalWei: string; feeTotalWei: string; buyerTotalWei: string; offerer: string;
  parameters: OrderParameters; signature: string; status: ListingStatus; validationState: string;
  validationDetails: unknown; validatorCodes: { errors: number[]; warnings: number[] };
  startTime: string; endTime: string; createdAt: string; updatedAt: string; lastValidatedAt: string;
  marketPair?: MarketPair | null; orderSide?: OrderSide | null; baseTokenAddress?: string | null; quoteTokenAddress?: string | null;
  baseDecimals?: number | null; quoteDecimals?: number | null; baseAmountInitial?: string | null; baseAmountRemaining?: string | null;
  unitPriceQuoteAtomic?: string | null; sellerQuoteTotalAtomic?: string | null; feeQuoteTotalAtomic?: string | null;
  buyerQuoteTotalAtomic?: string | null; fillStepBaseAtomic?: string | null;
};

export function isCircuitListing(listing: Pick<ListingRecord, "assetStandard">): listing is ListingRecord & { assetStandard: "ERC721"; assetType: "CIRCUIT"; transistorsAddress: null } {
  return listing.assetStandard === "ERC721";
}

export function isErc1155Listing(listing: Pick<ListingRecord, "assetStandard">): listing is ListingRecord & { assetStandard: "ERC1155"; assetType: "NAND" | "LATCH"; transistorsAddress: string } {
  return listing.assetStandard === "ERC1155";
}

export function isBemListing(listing: Pick<ListingRecord, "assetStandard">): listing is ListingRecord & { assetStandard: "ERC20"; assetType: "BEM"; marketPair: "BEM_USDT"; orderSide: "ASK"; processorAddress: null; transistorsAddress: null } {
  return listing.assetStandard === "ERC20";
}
