import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/errors.js";
import { assertListingCapacity, calculateListingCapacity, sumReservedListingQuantity } from "../../src/domain/listing-capacity.js";
import type { ListingStatus } from "../../src/domain/listing.js";

const now = "100";
const listing = (status: ListingStatus, remainingQuantity: string, endTime = "200") => ({ status, remainingQuantity, endTime });

describe("TapeMarket listing capacity", () => {
  it("computes empty, reserved and overcommitted capacity", () => {
    expect(calculateListingCapacity("500", "0", 0)).toEqual({ walletBalance: "500", reservedListingQuantity: "0", availableToList: "500", overcommittedQuantity: "0", reservingListingCount: 0 });
    expect(calculateListingCapacity("500", "200", 1)).toMatchObject({ availableToList: "300", overcommittedQuantity: "0" });
    expect(calculateListingCapacity("100", "200", 1)).toMatchObject({ availableToList: "0", overcommittedQuantity: "100" });
  });

  it("uses remaining quantity and exactly the conservative reserving statuses", () => {
    const result = sumReservedListingQuantity([
      listing("PENDING_VALIDATION", "10"), listing("ACTIVE", "20"), listing("PARTIALLY_FILLED", "80"),
      listing("STALE", "30"), listing("INVALID_BALANCE", "40"), listing("INVALID_APPROVAL", "50"),
      listing("CANCELLED", "100"), listing("FILLED", "100"), listing("EXPIRED", "100"),
      listing("INVALID_COUNTER", "100"), listing("INVALID_SIGNATURE", "100"), listing("INVALID_STRUCTURE", "100"),
      listing("INVALID_ASSET", "100"), listing("REJECTED", "100"), listing("ACTIVE", "999", "100"),
    ], now);
    expect(result).toEqual({ reservedListingQuantity: "230", reservingListingCount: 6 });
  });

  it("returns structured 409 capacity details", () => {
    const capacity = calculateListingCapacity("500", "400", 2);
    expect(() => assertListingCapacity(capacity, "200", "NAND")).toThrow(DomainError);
    try { assertListingCapacity(capacity, "200", "NAND"); } catch (error) {
      expect(error).toMatchObject({ code: "LISTING_CAPACITY_EXCEEDED", statusCode: 409, details: { walletBalance: "500", reservedListingQuantity: "400", availableToList: "100", requestedQuantity: "200", assetType: "NAND" } });
    }
  });
});
