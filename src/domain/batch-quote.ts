import { randomUUID } from "node:crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { DomainError } from "./errors.js";
import type { ListingRecord } from "./listing.js";
import { quoteFill } from "./order-math.js";

export type BatchQuoteMode = "SELECTED" | "SWEEP";
export type BatchCandidate = { listing: ListingRecord; sellerBalance: string };
export type BatchPlanItem = {
  orderHash: string;
  unitsToFill: string;
  sellerUnitPriceWei: string;
  takerFeePerUnitWei: string;
  buyerUnitTotalWei: string;
  sellerSubtotalWei: string;
  takerFeeWei: string;
  buyerTotalWei: string;
  listing: ListingRecord;
};

export type BatchQuote = {
  quoteId: string;
  planHash: string;
  mode: BatchQuoteMode;
  chainId: number;
  buyer: string;
  transistorsAddress: string;
  tokenId: string;
  asOfBlock: string;
  createdAt: string;
  expiresAt: string;
  budgetWei: string;
  maxSellerUnitPriceWei: string;
  maxOrders: number;
  sellerSubtotalWei: string;
  takerFeeWei: string;
  buyerTotalWei: string;
  unusedBudgetWei: string;
  totalUnits: string;
  orderCount: number;
  bestAskSellerUnitPriceWei: string;
  highestSellerUnitPriceWei: string;
  weightedAverageSellerUnitPriceWei: string;
  weightedAverageBuyerUnitWei: string;
  priceImpactBps: string;
  truncated: boolean;
  nextSellerUnitPriceWei: string | null;
  warnings: string[];
  items: BatchPlanItem[];
  disclaimer: "This quote does not reserve listings.";
};

type QuoteMeta = {
  chainId: number;
  buyer: string;
  transistorsAddress: string;
  tokenId: string;
  asOfBlock: string;
  ttlSeconds: number;
  maxOrders: number;
  warnings?: string[];
  now?: Date;
};

const byPriceAndHash = (a: BatchCandidate, b: BatchCandidate) => {
  const priceA = BigInt(a.listing.sellerUnitPriceWei); const priceB = BigInt(b.listing.sellerUnitPriceWei);
  return priceA === priceB ? a.listing.orderHash.localeCompare(b.listing.orderHash) : priceA < priceB ? -1 : 1;
};

function sellerKey(listing: ListingRecord) {
  return `${listing.offerer.toLowerCase()}:${listing.transistorsAddress.toLowerCase()}:${listing.tokenId}`;
}

function isCandidateFillable(listing: ListingRecord, buyer: string, now: Date) {
  return (listing.status === "ACTIVE" || listing.status === "PARTIALLY_FILLED") && BigInt(listing.remainingQuantity) > 0n && BigInt(listing.endTime) > BigInt(Math.floor(now.getTime() / 1_000)) && listing.offerer.toLowerCase() !== buyer.toLowerCase();
}

function makeItem(listing: ListingRecord, units: bigint): BatchPlanItem {
  const amounts = quoteFill(listing.sellerUnitPriceWei, units.toString());
  return {
    orderHash: listing.orderHash,
    unitsToFill: units.toString(),
    sellerUnitPriceWei: listing.sellerUnitPriceWei,
    takerFeePerUnitWei: listing.takerFeePerUnitWei,
    buyerUnitTotalWei: listing.buyerUnitTotalWei,
    sellerSubtotalWei: amounts.sellerProceedsWei,
    takerFeeWei: amounts.takerFeeWei,
    buyerTotalWei: amounts.buyerPaymentWei,
    listing,
  };
}

export function deterministicPlanHash(input: {
  chainId: number;
  buyer: string;
  transistorsAddress: string;
  tokenId: string;
  mode: BatchQuoteMode;
  maxSellerUnitPriceWei: string;
  maxOrders: number;
  items: Array<Pick<BatchPlanItem, "orderHash" | "unitsToFill" | "buyerUnitTotalWei">>;
}) {
  const canonical = {
    chainId: input.chainId,
    buyer: input.buyer.toLowerCase(),
    transistorsAddress: input.transistorsAddress.toLowerCase(),
    tokenId: input.tokenId,
    mode: input.mode,
    items: input.items.map((item) => ({ orderHash: item.orderHash.toLowerCase(), unitsToFill: item.unitsToFill, buyerUnitTotalWei: item.buyerUnitTotalWei })),
    maxSellerUnitPriceWei: input.maxSellerUnitPriceWei,
    maxOrders: input.maxOrders,
  };
  return keccak256(toUtf8Bytes(JSON.stringify(canonical)));
}

function finalize(meta: QuoteMeta, mode: BatchQuoteMode, items: BatchPlanItem[], budget: bigint, maxPrice: bigint, truncated: boolean, nextPrice: string | null): BatchQuote {
  if (!items.length) throw new DomainError("BATCH_EMPTY", "No fillable listings matched this batch", 409);
  const sellerSubtotal = items.reduce((sum, item) => sum + BigInt(item.sellerSubtotalWei), 0n);
  const fee = items.reduce((sum, item) => sum + BigInt(item.takerFeeWei), 0n);
  const buyerTotal = sellerSubtotal + fee;
  const units = items.reduce((sum, item) => sum + BigInt(item.unitsToFill), 0n);
  const bestAsk = BigInt(items[0]!.sellerUnitPriceWei);
  const highest = items.reduce((value, item) => BigInt(item.sellerUnitPriceWei) > value ? BigInt(item.sellerUnitPriceWei) : value, 0n);
  const weightedSeller = sellerSubtotal / units;
  const weightedBuyer = buyerTotal / units;
  const priceImpactBps = bestAsk === 0n ? 0n : (highest - bestAsk) * 10_000n / bestAsk;
  const now = meta.now ?? new Date(); const expiresAt = new Date(now.getTime() + meta.ttlSeconds * 1_000);
  const planHash = deterministicPlanHash({ ...meta, mode, maxSellerUnitPriceWei: maxPrice.toString(), items });
  return {
    quoteId: randomUUID(), planHash, mode, chainId: meta.chainId, buyer: meta.buyer,
    transistorsAddress: meta.transistorsAddress, tokenId: meta.tokenId, asOfBlock: meta.asOfBlock,
    createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), budgetWei: budget.toString(),
    maxSellerUnitPriceWei: maxPrice.toString(), maxOrders: meta.maxOrders,
    sellerSubtotalWei: sellerSubtotal.toString(), takerFeeWei: fee.toString(), buyerTotalWei: buyerTotal.toString(),
    unusedBudgetWei: (budget > buyerTotal ? budget - buyerTotal : 0n).toString(), totalUnits: units.toString(), orderCount: items.length,
    bestAskSellerUnitPriceWei: bestAsk.toString(), highestSellerUnitPriceWei: highest.toString(),
    weightedAverageSellerUnitPriceWei: weightedSeller.toString(), weightedAverageBuyerUnitWei: weightedBuyer.toString(),
    priceImpactBps: priceImpactBps.toString(), truncated, nextSellerUnitPriceWei: nextPrice,
    warnings: meta.warnings ?? [], items, disclaimer: "This quote does not reserve listings.",
  };
}

export function buildSelectedBatchQuote(meta: QuoteMeta, candidates: BatchCandidate[], requested: Array<{ orderHash: string; quantity: string }>) {
  if (!requested.length) throw new DomainError("BATCH_EMPTY", "Select at least one listing");
  if (requested.length > meta.maxOrders) throw new DomainError("BATCH_TOO_MANY_ORDERS", `A batch supports at most ${meta.maxOrders} listings`);
  const duplicates = new Set<string>(); const candidateMap = new Map(candidates.map((candidate) => [candidate.listing.orderHash.toLowerCase(), candidate]));
  const stock = new Map<string, bigint>(); const items: BatchPlanItem[] = [];
  for (const request of requested) {
    const hash = request.orderHash.toLowerCase();
    if (duplicates.has(hash)) throw new DomainError("BATCH_PLAN_CHANGED", "Duplicate listing in selected batch", 409);
    duplicates.add(hash);
    const candidate = candidateMap.get(hash); if (!candidate) throw new DomainError("LISTING_NOT_FOUND", `Listing ${request.orderHash} was not found`, 409);
    if (candidate.listing.offerer.toLowerCase() === meta.buyer.toLowerCase()) throw new DomainError("SELF_LISTING", `Cannot buy own listing ${request.orderHash}`, 409);
    if (!isCandidateFillable(candidate.listing, meta.buyer, meta.now ?? new Date())) throw new DomainError("LISTING_NOT_FILLABLE", `Listing ${request.orderHash} is not fillable`, 409);
    const quantity = BigInt(request.quantity); const remaining = BigInt(candidate.listing.remainingQuantity);
    if (quantity <= 0n || quantity > remaining) throw new DomainError("LISTING_QUANTITY_CHANGED", `Listing ${request.orderHash} quantity changed`, 409);
    const key = sellerKey(candidate.listing); const available = stock.get(key) ?? BigInt(candidate.sellerBalance);
    if (quantity > available) throw new DomainError("INSUFFICIENT_SELLER_BALANCE", `Seller inventory cannot cover listing ${request.orderHash}`, 409);
    stock.set(key, available - quantity); items.push(makeItem(candidate.listing, quantity));
  }
  items.sort((a, b) => BigInt(a.sellerUnitPriceWei) === BigInt(b.sellerUnitPriceWei) ? a.orderHash.localeCompare(b.orderHash) : BigInt(a.sellerUnitPriceWei) < BigInt(b.sellerUnitPriceWei) ? -1 : 1);
  const total = items.reduce((sum, item) => sum + BigInt(item.buyerTotalWei), 0n);
  const maxPrice = items.reduce((value, item) => BigInt(item.sellerUnitPriceWei) > value ? BigInt(item.sellerUnitPriceWei) : value, 0n);
  return finalize(meta, "SELECTED", items, total, maxPrice, false, null);
}

export function buildSweepBatchQuote(meta: QuoteMeta, candidates: BatchCandidate[], budget: bigint, maxPrice: bigint) {
  if (budget <= 0n) throw new DomainError("BUDGET_TOO_LOW", "Sweep budget must buy at least one unit");
  const ordered = candidates.filter((candidate) => isCandidateFillable(candidate.listing, meta.buyer, meta.now ?? new Date())).sort(byPriceAndHash); const stock = new Map<string, bigint>(); const items: BatchPlanItem[] = [];
  let remainingBudget = budget; let nextPrice: string | null = null;
  for (const candidate of ordered) {
    const listing = candidate.listing;
    if (BigInt(listing.sellerUnitPriceWei) > maxPrice) { nextPrice = listing.sellerUnitPriceWei; break; }
    if (items.length >= meta.maxOrders) { nextPrice = listing.sellerUnitPriceWei; break; }
    const unitCost = BigInt(listing.buyerUnitTotalWei); const affordable = remainingBudget / unitCost;
    if (affordable <= 0n) { nextPrice = listing.sellerUnitPriceWei; break; }
    const key = sellerKey(listing); const sellerAvailable = stock.get(key) ?? BigInt(candidate.sellerBalance);
    const units = [BigInt(listing.remainingQuantity), affordable, sellerAvailable].reduce((minimum, value) => value < minimum ? value : minimum);
    if (units <= 0n) continue;
    const item = makeItem(listing, units); items.push(item); remainingBudget -= BigInt(item.buyerTotalWei); stock.set(key, sellerAvailable - units);
    if (units < BigInt(listing.remainingQuantity)) { nextPrice = listing.sellerUnitPriceWei; break; }
  }
  if (!items.length) throw new DomainError("BUDGET_TOO_LOW", "Budget is below the cost of one available unit", 409);
  const truncated = items.length >= meta.maxOrders && nextPrice !== null;
  return finalize(meta, "SWEEP", items, budget, maxPrice, truncated, nextPrice);
}

export function assertBatchQuoteExpectation(quote: BatchQuote, expectedPlanHash?: string, quoteExpiresAt?: string) {
  if (quoteExpiresAt && Date.parse(quoteExpiresAt) <= Date.now()) throw new DomainError("BATCH_QUOTE_EXPIRED", "Batch quote expired", 409, { quote });
  if (expectedPlanHash && expectedPlanHash.toLowerCase() !== quote.planHash.toLowerCase()) throw new DomainError("BATCH_PLAN_CHANGED", "Batch plan changed", 409, { quote });
  return quote;
}
