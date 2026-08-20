import { z } from "zod";

const decimal = z.string().regex(/^\d+$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const quoteSchema = z.object({ processorAddress: address, transistorsAddress: address, tokenId: z.enum(["0", "1"]), sellerUnitPriceWei: decimal, quantity: decimal, endTime: decimal });
const offerItem = z.object({ itemType: z.number().int(), token: address, identifierOrCriteria: decimal, startAmount: decimal, endAmount: decimal });
const considerationItem = offerItem.extend({ recipient: address });
export const signedListingSchema = z.object({
  processorAddress: address, orderHash: bytes32.optional(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  parameters: z.object({ offerer: address, zone: address, offer: z.array(offerItem), consideration: z.array(considerationItem), orderType: z.number().int(), startTime: decimal, endTime: decimal, zoneHash: bytes32, salt: decimal.or(bytes32), conduitKey: bytes32, totalOriginalConsiderationItems: decimal, counter: decimal }),
});
export const hashParamsSchema = z.object({ orderHash: bytes32 });
export const marketParamsSchema = z.object({ transistorsAddress: address, tokenId: z.enum(["0", "1"] ) });
export const accountParamsSchema = z.object({ address });

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
