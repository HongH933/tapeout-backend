import { DomainError } from "./errors.js";
import { RESERVING_LISTING_STATUSES, type ListingStatus } from "./listing.js";

export function isReservingListing(status: ListingStatus, endTime: string | bigint, nowSeconds: string | bigint) {
  return RESERVING_LISTING_STATUSES.includes(status as typeof RESERVING_LISTING_STATUSES[number]) && BigInt(endTime) > BigInt(nowSeconds);
}

export function sumReservedListingQuantity(listings: Array<{ status: ListingStatus; endTime: string; remainingQuantity: string }>, nowSeconds: string | bigint) {
  const reserving = listings.filter((listing) => isReservingListing(listing.status, listing.endTime, nowSeconds));
  return { reservedListingQuantity: reserving.reduce((sum, listing) => sum + BigInt(listing.remainingQuantity), 0n).toString(), reservingListingCount: reserving.length };
}

export function calculateListingCapacity(walletBalanceValue: string | bigint, reservedValue: string | bigint, reservingListingCount: number) {
  const walletBalance = BigInt(walletBalanceValue);
  const reservedListingQuantity = BigInt(reservedValue);
  const availableToList = walletBalance > reservedListingQuantity ? walletBalance - reservedListingQuantity : 0n;
  const overcommittedQuantity = reservedListingQuantity > walletBalance ? reservedListingQuantity - walletBalance : 0n;
  return {
    walletBalance: walletBalance.toString(),
    reservedListingQuantity: reservedListingQuantity.toString(),
    availableToList: availableToList.toString(),
    overcommittedQuantity: overcommittedQuantity.toString(),
    reservingListingCount,
  };
}

export function assertListingCapacity(capacity: ReturnType<typeof calculateListingCapacity>, requestedQuantityValue: string, assetType?: "NAND" | "LATCH") {
  if (BigInt(requestedQuantityValue) <= BigInt(capacity.availableToList)) return;
  throw new DomainError("LISTING_CAPACITY_EXCEEDED", "Listing quantity exceeds the amount currently available to list.", 409, {
    walletBalance: capacity.walletBalance,
    reservedListingQuantity: capacity.reservedListingQuantity,
    availableToList: capacity.availableToList,
    requestedQuantity: requestedQuantityValue,
    ...(assetType ? { assetType } : {}),
  });
}
