import { DomainError } from "./errors.js";

export const UINT256_MAX = (1n << 256n) - 1n;
export const BPS_DENOMINATOR = 10_000n;

function positive(value: string, code: "INVALID_QUANTITY" | "PRICE_NOT_PARTIAL_FILL_SAFE") {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new DomainError(code, "Value must be a positive base-10 integer string");
  return BigInt(value);
}

function checkedMultiply(a: bigint, b: bigint) {
  if (a !== 0n && b > UINT256_MAX / a) throw new DomainError("UINT256_OVERFLOW", "Order amount exceeds uint256");
  return a * b;
}

export function quoteOrder(sellerUnitPrice: string, quantityValue: string, takerFeeBps = 100n) {
  const sellerUnitPriceWei = positive(sellerUnitPrice, "PRICE_NOT_PARTIAL_FILL_SAFE");
  const quantity = positive(quantityValue, "INVALID_QUANTITY");
  const feeNumerator = checkedMultiply(sellerUnitPriceWei, takerFeeBps);
  if (feeNumerator % BPS_DENOMINATOR !== 0n) {
    throw new DomainError("PRICE_NOT_PARTIAL_FILL_SAFE", "Unit price must produce an exact per-unit fee for every partial fill");
  }
  const takerFeePerUnitWei = feeNumerator / BPS_DENOMINATOR;
  if (takerFeePerUnitWei <= 0n) throw new DomainError("PRICE_NOT_PARTIAL_FILL_SAFE", "Unit price is too small to produce a non-zero exact fee");
  const sellerTotalWei = checkedMultiply(sellerUnitPriceWei, quantity);
  const feeTotalWei = checkedMultiply(takerFeePerUnitWei, quantity);
  if (sellerTotalWei > UINT256_MAX - feeTotalWei) throw new DomainError("UINT256_OVERFLOW", "Buyer total exceeds uint256");
  return {
    sellerUnitPriceWei: sellerUnitPriceWei.toString(), quantity: quantity.toString(),
    takerFeePerUnitWei: takerFeePerUnitWei.toString(), buyerUnitTotalWei: (sellerUnitPriceWei + takerFeePerUnitWei).toString(),
    sellerTotalWei: sellerTotalWei.toString(), feeTotalWei: feeTotalWei.toString(), buyerTotalWei: (sellerTotalWei + feeTotalWei).toString(),
  };
}

export function quoteFill(sellerUnitPriceWei: string, fillQuantity: string, takerFeeBps = 100n) {
  const quote = quoteOrder(sellerUnitPriceWei, fillQuantity, takerFeeBps);
  return { sellerProceedsWei: quote.sellerTotalWei, takerFeeWei: quote.feeTotalWei, buyerPaymentWei: quote.buyerTotalWei };
}
