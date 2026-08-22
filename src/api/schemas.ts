import { z } from "zod";

const decimal = z.string().regex(/^\d+$/);
const decimalOrNumber = z.union([decimal, z.number().int().nonnegative().safe()]).transform(String);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const erc1155QuoteSchema = z.object({ assetStandard: z.literal("ERC1155"), processorAddress: address, transistorsAddress: address, collectionAddress: address.optional(), tokenId: z.enum(["0", "1"]), sellerUnitPriceWei: decimal, quantity: decimal, endTime: decimal, offerer: address.optional() });
const circuitQuoteSchema = z.object({ assetStandard: z.literal("ERC721"), processorAddress: address, collectionAddress: address, tokenId: decimal, sellerUnitPriceWei: decimal, endTime: decimal, offerer: address });
const bemQuoteSchema = z.object({ assetStandard: z.literal("ERC20"), assetType: z.literal("BEM").default("BEM"), marketPair: z.literal("BEM_USDT").default("BEM_USDT"), orderSide: z.literal("ASK").default("ASK"), offerer: address, baseAmountAtomic: decimal, unitPriceQuoteAtomic: decimal, endTime: decimal });
export const quoteSchema = z.preprocess((value) => value && typeof value === "object" && !("assetStandard" in value) ? { ...value, assetStandard: "ERC1155" } : value, z.discriminatedUnion("assetStandard", [erc1155QuoteSchema, circuitQuoteSchema, bemQuoteSchema]));
const offerItem = z.object({ itemType: z.number().int(), token: address, identifierOrCriteria: decimal, startAmount: decimal, endAmount: decimal });
const considerationItem = offerItem.extend({ recipient: address });
const signedListingBase = z.object({
  processorAddress: address, collectionAddress: address.optional(), orderHash: bytes32.optional(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  parameters: z.object({ offerer: address, zone: address, offer: z.array(offerItem), consideration: z.array(considerationItem), orderType: z.number().int(), startTime: decimal, endTime: decimal, zoneHash: bytes32, salt: decimal.or(bytes32), conduitKey: bytes32, totalOriginalConsiderationItems: decimalOrNumber, counter: decimal }),
});
export const signedListingSchema = z.preprocess((value) => value && typeof value === "object" && !("assetStandard" in value) ? { ...value, assetStandard: "ERC1155" } : value, z.discriminatedUnion("assetStandard", [
  signedListingBase.extend({ assetStandard: z.literal("ERC1155") }),
  signedListingBase.extend({ assetStandard: z.literal("ERC721"), collectionAddress: address }),
  signedListingBase.omit({ processorAddress: true }).extend({ assetStandard: z.literal("ERC20"), assetType: z.literal("BEM"), marketPair: z.literal("BEM_USDT"), orderSide: z.literal("ASK"), collectionAddress: address }),
]));
export const hashParamsSchema = z.object({ orderHash: bytes32 });
export const marketParamsSchema = z.object({ transistorsAddress: address, tokenId: z.enum(["0", "1"] ) });
export const accountParamsSchema = z.object({ address });
export const listingCapacityParamsSchema = z.object({ address, transistorsAddress: address, tokenId: z.enum(["0", "1"]) });
export const marketSummariesSchema = z.object({ markets: z.array(z.object({ transistorsAddress: address, tokenId: z.enum(["0", "1"]) })).min(1).max(50) });
export const circuitCollectionParamsSchema = z.object({ collectionAddress: address });
export const circuitParamsSchema = z.object({ collectionAddress: address, tokenId: decimal });
export const circuitCapacityParamsSchema = z.object({ address, collectionAddress: address, tokenId: decimal });
export const circuitSummariesSchema = z.object({ collections: z.array(address).min(1).max(2) });
export const circuitListQuerySchema = z.object({ cursor: z.string().min(1).optional(), sort: z.enum(["price_asc", "newest"]).default("price_asc"), limit: z.coerce.number().int().min(1).max(100).default(24) });

const selectedBatchSchema = z.object({
  mode: z.literal("SELECTED"), buyer: address,
  items: z.array(z.object({ orderHash: bytes32, quantity: decimal })).min(1),
  expectedPlanHash: bytes32.optional(), quoteExpiresAt: z.string().datetime().optional(),
});
const sweepBatchSchema = z.object({
  mode: z.literal("SWEEP"), buyer: address, budgetWei: decimal,
  maxSellerUnitPriceWei: decimal, maxOrders: z.number().int().positive().optional(),
  expectedPlanHash: bytes32.optional(), quoteExpiresAt: z.string().datetime().optional(),
});
export const batchQuoteSchema = z.discriminatedUnion("mode", [selectedBatchSchema, sweepBatchSchema]);
export const revalidateBatchSchema = z.object({ orderHashes: z.array(bytes32).min(1) });
export const bemListQuerySchema = z.object({ cursor: z.string().min(1).optional(), sort: z.enum(["price_asc", "newest"]).default("price_asc"), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const bemFillQuoteSchema = z.object({ orderHash: bytes32, buyer: address, baseAmountAtomic: decimal });
