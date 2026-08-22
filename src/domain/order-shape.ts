import { getAddress, isAddress, ZeroAddress, ZeroHash } from "ethers";
import { ItemType, OrderType } from "@opensea/seaport-js/lib/constants.js";
import type { OrderParameters } from "./listing.js";
import { DomainError } from "./errors.js";
import { quoteOrder } from "./order-math.js";
import { quoteBemAsk } from "./bem-order-math.js";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const requireAddress = (value: string) => { if (!isAddress(value)) throw new DomainError("INVALID_STRUCTURE", `Invalid address: ${value}`); return getAddress(value); };
type ShapeExpectation = { collectionAddress: string; tokenId: string; feeRecipient: string; now: bigint; maxDuration: bigint };

export function validateCommonSeaportFields(parameters: OrderParameters, expected: Pick<ShapeExpectation, "now" | "maxDuration">) {
  requireAddress(parameters.offerer);
  if (!same(parameters.zone, ZeroAddress) || parameters.zoneHash !== ZeroHash || parameters.conduitKey !== ZeroHash) throw new DomainError("INVALID_STRUCTURE", "V1 requires zero zone, zero zoneHash and zero conduitKey");
  if (parameters.offer.length !== 1 || parameters.consideration.length !== 2 || parameters.totalOriginalConsiderationItems !== "2") throw new DomainError("INVALID_STRUCTURE", "Listing must contain one offer and exactly two original consideration items");
  const start = BigInt(parameters.startTime); const end = BigInt(parameters.endTime);
  if (start > expected.now + 120n || end <= expected.now) throw new DomainError("ORDER_EXPIRED", "Order is not active");
  if (end - start > expected.maxDuration) throw new DomainError("INVALID_STRUCTURE", "Order duration exceeds 30 days");
  return { offer: parameters.offer[0]!, seller: parameters.consideration[0]!, fee: parameters.consideration[1]! };
}

export function validateNativeConsiderationShape(parameters: OrderParameters, expected: ShapeExpectation) {
  const result = validateCommonSeaportFields(parameters, expected); const { offer, seller, fee } = result;
  if (!same(offer.token, expected.collectionAddress) || offer.identifierOrCriteria !== expected.tokenId || offer.startAmount !== offer.endAmount) throw new DomainError("INVALID_STRUCTURE", "Offered TapeOut asset does not match the requested collection and token ID");
  for (const item of [seller, fee]) if (item.itemType !== ItemType.NATIVE || !same(item.token, ZeroAddress) || item.identifierOrCriteria !== "0" || item.startAmount !== item.endAmount) throw new DomainError("INVALID_STRUCTURE", "Consideration must contain fixed native BNB items");
  if (!same(seller.recipient, parameters.offerer) || !same(fee.recipient, expected.feeRecipient)) throw new DomainError("INVALID_STRUCTURE", "Consideration recipients do not match seller and configured fee recipient");
  return result;
}

export function validateErc20ConsiderationShape(parameters: OrderParameters, expected: ShapeExpectation & { quoteTokenAddress: string }) {
  const result = validateCommonSeaportFields(parameters, expected); const { offer, seller, fee } = result;
  if (!same(offer.token, expected.collectionAddress) || offer.identifierOrCriteria !== "0" || offer.startAmount !== offer.endAmount) throw new DomainError("INVALID_ERC20_ORDER", "BEM offer does not match the configured token");
  for (const item of [seller, fee]) if (item.itemType !== ItemType.ERC20 || !same(item.token, expected.quoteTokenAddress) || item.identifierOrCriteria !== "0" || item.startAmount !== item.endAmount) throw new DomainError("INVALID_ERC20_ORDER", "BEM consideration must contain fixed USDT ERC-20 items");
  if (!same(seller.recipient, parameters.offerer) || !same(fee.recipient, expected.feeRecipient)) throw new DomainError("INVALID_ERC20_ORDER", "USDT recipients do not match seller and configured fee recipient");
  return result;
}

export function validateErc1155OrderShape(parameters: OrderParameters, expected: ShapeExpectation) {
  const { offer, seller, fee } = validateNativeConsiderationShape(parameters, expected);
  if (parameters.orderType !== OrderType.PARTIAL_OPEN) throw new DomainError("INVALID_ORDER_TYPE", "ERC-1155 listings require PARTIAL_OPEN");
  if (offer.itemType !== ItemType.ERC1155) throw new DomainError("INVALID_STRUCTURE", "Offer must be one fixed ERC-1155 TapeOut item");
  const quantity = BigInt(offer.startAmount); if (quantity <= 0n) throw new DomainError("INVALID_QUANTITY", "Quantity must be positive");
  if (BigInt(seller.startAmount) % quantity !== 0n || BigInt(fee.startAmount) % quantity !== 0n) throw new DomainError("PRICE_NOT_PARTIAL_FILL_SAFE", "Consideration amounts are not divisible by quantity");
  const quote = quoteOrder((BigInt(seller.startAmount) / quantity).toString(), quantity.toString());
  if (seller.startAmount !== quote.sellerTotalWei || fee.startAmount !== quote.feeTotalWei) throw new DomainError("INVALID_STRUCTURE", "Seller proceeds or taker fee does not match configured math");
  return quote;
}

export function validateCircuitOrderShape(parameters: OrderParameters, expected: ShapeExpectation) {
  const { offer, seller, fee } = validateNativeConsiderationShape(parameters, expected);
  if (parameters.orderType !== OrderType.FULL_OPEN) throw new DomainError("INVALID_ORDER_TYPE", "Circuit listings require FULL_OPEN");
  if (offer.itemType !== ItemType.ERC721 || offer.startAmount !== "1" || offer.endAmount !== "1") throw new DomainError("ERC721_PARTIAL_FILL_FORBIDDEN", "Circuit offer must be one ERC-721 and cannot be partially filled");
  const quote = quoteOrder(seller.startAmount, "1");
  if (seller.startAmount !== quote.sellerTotalWei || fee.startAmount !== quote.feeTotalWei) throw new DomainError("INVALID_STRUCTURE", "Seller proceeds or taker fee does not match configured math");
  return quote;
}

export function validateBemAskOrderShape(parameters: OrderParameters, expected: ShapeExpectation & { quoteTokenAddress: string; baseDecimals: number; quoteDecimals: number }) {
  const { offer, seller, fee } = validateErc20ConsiderationShape(parameters, expected);
  if (parameters.orderType !== OrderType.PARTIAL_OPEN) throw new DomainError("INVALID_ORDER_TYPE", "BEM asks require PARTIAL_OPEN");
  if (offer.itemType !== ItemType.ERC20) throw new DomainError("INVALID_ERC20_ORDER", "BEM offer must use ItemType.ERC20");
  const quantity = BigInt(offer.startAmount); const sellerTotal = BigInt(seller.startAmount); const baseScale = 10n ** BigInt(expected.baseDecimals);
  if (quantity <= 0n || sellerTotal <= 0n || sellerTotal * baseScale % quantity !== 0n) throw new DomainError("PRICE_NOT_PARTIAL_FILL_SAFE", "BEM order does not encode an exact unit price");
  const quote = quoteBemAsk({ baseAmountAtomic: offer.startAmount, unitPriceQuoteAtomic: (sellerTotal * baseScale / quantity).toString(), baseDecimals: expected.baseDecimals, quoteDecimals: expected.quoteDecimals });
  if (seller.startAmount !== quote.sellerQuoteTotalAtomic || fee.startAmount !== quote.takerFeeQuoteAtomic) throw new DomainError("INVALID_ERC20_ORDER", "BEM seller proceeds or 1% fee does not match configured math");
  return quote;
}

export function validateMarketplaceOrderShape(parameters: OrderParameters, expected: ShapeExpectation & { assetStandard: "ERC1155" | "ERC721" | "ERC20"; quoteTokenAddress?: string; baseDecimals?: number; quoteDecimals?: number }) {
  if (expected.assetStandard === "ERC721") return validateCircuitOrderShape(parameters, expected);
  if (expected.assetStandard === "ERC20") {
    if (!expected.quoteTokenAddress || expected.baseDecimals === undefined || expected.quoteDecimals === undefined) throw new DomainError("INVALID_ERC20_ORDER", "BEM token metadata is missing");
    return validateBemAskOrderShape(parameters, { ...expected, quoteTokenAddress: expected.quoteTokenAddress, baseDecimals: expected.baseDecimals, quoteDecimals: expected.quoteDecimals });
  }
  return validateErc1155OrderShape(parameters, expected);
}

export function validateOrderShape(parameters: OrderParameters, expected: { transistorsAddress: string; tokenId: string; feeRecipient: string; now: bigint; maxDuration: bigint }) {
  return validateErc1155OrderShape(parameters, { ...expected, collectionAddress: expected.transistorsAddress });
}
