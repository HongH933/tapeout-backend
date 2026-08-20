import { getAddress, isAddress, ZeroAddress, ZeroHash } from "ethers";
import type { OrderParameters } from "./listing.js";
import { DomainError } from "./errors.js";
import { quoteOrder } from "./order-math.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const requireAddress = (value: string) => { if (!isAddress(value)) throw new DomainError("INVALID_STRUCTURE", `Invalid address: ${value}`); return getAddress(value); };

export function validateOrderShape(parameters: OrderParameters, expected: { transistorsAddress: string; tokenId: string; feeRecipient: string; now: bigint; maxDuration: bigint }) {
  requireAddress(parameters.offerer);
  if (!same(parameters.zone, ZeroAddress) || parameters.zoneHash !== ZeroHash || parameters.conduitKey !== ZeroHash || parameters.orderType !== 1) {
    throw new DomainError("INVALID_STRUCTURE", "V1 requires PARTIAL_OPEN, zero zone, zero zoneHash and zero conduitKey");
  }
  if (parameters.offer.length !== 1 || parameters.consideration.length !== 2 || parameters.totalOriginalConsiderationItems !== "2") {
    throw new DomainError("INVALID_STRUCTURE", "Listing must contain one offer and exactly two original consideration items");
  }
  const offer = parameters.offer[0]!;
  if (offer.itemType !== 3 || !same(offer.token, expected.transistorsAddress) || offer.identifierOrCriteria !== expected.tokenId || offer.startAmount !== offer.endAmount) {
    throw new DomainError("INVALID_STRUCTURE", "Offer must be one fixed ERC-1155 TapeOut item");
  }
  const seller = parameters.consideration[0]!;
  const fee = parameters.consideration[1]!;
  for (const item of [seller, fee]) {
    if (item.itemType !== 0 || !same(item.token, ZeroAddress) || item.identifierOrCriteria !== "0" || item.startAmount !== item.endAmount) {
      throw new DomainError("INVALID_STRUCTURE", "Consideration must contain fixed native BNB items");
    }
  }
  if (!same(seller.recipient, parameters.offerer) || !same(fee.recipient, expected.feeRecipient)) throw new DomainError("INVALID_STRUCTURE", "Consideration recipients do not match seller and configured fee recipient");
  const start = BigInt(parameters.startTime); const end = BigInt(parameters.endTime);
  if (start > expected.now + 120n || end <= expected.now) throw new DomainError("ORDER_EXPIRED", "Order is not active");
  if (end - start > expected.maxDuration) throw new DomainError("INVALID_STRUCTURE", "Order duration exceeds 30 days");
  const quantity = BigInt(offer.startAmount);
  if (quantity <= 0n) throw new DomainError("INVALID_QUANTITY", "Quantity must be positive");
  if (BigInt(seller.startAmount) % quantity !== 0n || BigInt(fee.startAmount) % quantity !== 0n) throw new DomainError("PRICE_NOT_PARTIAL_FILL_SAFE", "Consideration amounts are not divisible by quantity");
  const quote = quoteOrder((BigInt(seller.startAmount) / quantity).toString(), quantity.toString());
  if (seller.startAmount !== quote.sellerTotalWei || fee.startAmount !== quote.feeTotalWei) throw new DomainError("INVALID_STRUCTURE", "Seller proceeds or taker fee does not match configured math");
  return quote;
}
