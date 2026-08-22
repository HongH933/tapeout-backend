import { getAddress, isAddress, ZeroAddress, ZeroHash } from "ethers";
import { ItemType, OrderType } from "@opensea/seaport-js/lib/constants.js";
import type { OrderParameters } from "./listing.js";
import { DomainError } from "./errors.js";
import { quoteOrder } from "./order-math.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const requireAddress = (value: string) => { if (!isAddress(value)) throw new DomainError("INVALID_STRUCTURE", `Invalid address: ${value}`); return getAddress(value); };

type ShapeExpectation = { collectionAddress: string; tokenId: string; feeRecipient: string; now: bigint; maxDuration: bigint };

function validateCommonOrderShape(parameters: OrderParameters, expected: ShapeExpectation) {
  requireAddress(parameters.offerer);
  if (!same(parameters.zone, ZeroAddress) || parameters.zoneHash !== ZeroHash || parameters.conduitKey !== ZeroHash) throw new DomainError("INVALID_STRUCTURE", "V1 requires zero zone, zero zoneHash and zero conduitKey");
  if (parameters.offer.length !== 1 || parameters.consideration.length !== 2 || parameters.totalOriginalConsiderationItems !== "2") {
    throw new DomainError("INVALID_STRUCTURE", "Listing must contain one offer and exactly two original consideration items");
  }
  const offer = parameters.offer[0]!;
  if (!same(offer.token, expected.collectionAddress) || offer.identifierOrCriteria !== expected.tokenId || offer.startAmount !== offer.endAmount) throw new DomainError("INVALID_STRUCTURE", "Offered TapeOut asset does not match the requested collection and token ID");
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
  return { offer, seller, fee };
}

export function validateErc1155OrderShape(parameters: OrderParameters, expected: ShapeExpectation) {
  const { offer, seller, fee } = validateCommonOrderShape(parameters, expected);
  if (parameters.orderType !== OrderType.PARTIAL_OPEN) throw new DomainError("INVALID_ORDER_TYPE", "ERC-1155 listings require PARTIAL_OPEN");
  if (offer.itemType !== ItemType.ERC1155) throw new DomainError("INVALID_STRUCTURE", "Offer must be one fixed ERC-1155 TapeOut item");
  const quantity = BigInt(offer.startAmount);
  if (quantity <= 0n) throw new DomainError("INVALID_QUANTITY", "Quantity must be positive");
  if (BigInt(seller.startAmount) % quantity !== 0n || BigInt(fee.startAmount) % quantity !== 0n) throw new DomainError("PRICE_NOT_PARTIAL_FILL_SAFE", "Consideration amounts are not divisible by quantity");
  const quote = quoteOrder((BigInt(seller.startAmount) / quantity).toString(), quantity.toString());
  if (seller.startAmount !== quote.sellerTotalWei || fee.startAmount !== quote.feeTotalWei) throw new DomainError("INVALID_STRUCTURE", "Seller proceeds or taker fee does not match configured math");
  return quote;
}

export function validateCircuitOrderShape(parameters: OrderParameters, expected: ShapeExpectation) {
  const { offer, seller, fee } = validateCommonOrderShape(parameters, expected);
  if (parameters.orderType !== OrderType.FULL_OPEN) throw new DomainError("INVALID_ORDER_TYPE", "Circuit listings require FULL_OPEN");
  if (offer.itemType !== ItemType.ERC721) throw new DomainError("INVALID_STRUCTURE", "Circuit offer must use ItemType.ERC721");
  if (offer.startAmount !== "1" || offer.endAmount !== "1") throw new DomainError("ERC721_PARTIAL_FILL_FORBIDDEN", "Circuit listings cannot be partially filled");
  const quote = quoteOrder(seller.startAmount, "1");
  if (seller.startAmount !== quote.sellerTotalWei || fee.startAmount !== quote.feeTotalWei) throw new DomainError("INVALID_STRUCTURE", "Seller proceeds or taker fee does not match configured math");
  return quote;
}

export function validateMarketplaceOrderShape(parameters: OrderParameters, expected: ShapeExpectation & { assetStandard: "ERC1155" | "ERC721" }) {
  return expected.assetStandard === "ERC721" ? validateCircuitOrderShape(parameters, expected) : validateErc1155OrderShape(parameters, expected);
}

export function validateOrderShape(parameters: OrderParameters, expected: { transistorsAddress: string; tokenId: string; feeRecipient: string; now: bigint; maxDuration: bigint }) {
  return validateErc1155OrderShape(parameters, { ...expected, collectionAddress: expected.transistorsAddress });
}
