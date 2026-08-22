import { formatUnits } from "ethers";
import { BPS_DENOMINATOR, UINT256_MAX } from "./order-math.js";
import { DomainError } from "./errors.js";

const decimal = (value: string, code: "INVALID_QUANTITY" | "PRICE_NOT_PARTIAL_FILL_SAFE") => {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new DomainError(code, "Value must be a positive decimal integer string");
  return BigInt(value);
};
const checkedMultiply = (a: bigint, b: bigint) => {
  if (a !== 0n && b > UINT256_MAX / a) throw new DomainError("UINT256_OVERFLOW", "BEM order amount exceeds uint256");
  return a * b;
};
export function gcd(a: bigint, b: bigint): bigint { while (b !== 0n) [a, b] = [b, a % b]; return a < 0n ? -a : a; }
export function lcm(a: bigint, b: bigint): bigint { return a === 0n || b === 0n ? 0n : a / gcd(a, b) * b; }

export function quoteBemAsk(input: { baseAmountAtomic: string; unitPriceQuoteAtomic: string; baseDecimals: number; quoteDecimals: number; takerFeeBps?: bigint }) {
  const quantity = decimal(input.baseAmountAtomic, "INVALID_QUANTITY");
  const price = decimal(input.unitPriceQuoteAtomic, "PRICE_NOT_PARTIAL_FILL_SAFE");
  if (!Number.isInteger(input.baseDecimals) || input.baseDecimals < 0 || input.baseDecimals > 255 || !Number.isInteger(input.quoteDecimals) || input.quoteDecimals < 0 || input.quoteDecimals > 255) throw new DomainError("INVALID_ASSET", "Invalid token decimals");
  const baseScale = 10n ** BigInt(input.baseDecimals); const feeBps = input.takerFeeBps ?? 100n;
  const sellerNumerator = checkedMultiply(quantity, price);
  if (sellerNumerator % baseScale !== 0n) throw new DomainError("PRICE_NOT_PARTIAL_FILL_SAFE", "BEM quantity and unit price do not produce exact USDT proceeds");
  const seller = sellerNumerator / baseScale; const feeNumerator = checkedMultiply(seller, feeBps);
  if (feeNumerator % BPS_DENOMINATOR !== 0n) throw new DomainError("PRICE_NOT_PARTIAL_FILL_SAFE", "Seller proceeds do not produce an exact taker fee");
  const fee = feeNumerator / BPS_DENOMINATOR;
  if (seller <= 0n || fee <= 0n || seller > UINT256_MAX - fee) throw new DomainError("PRICE_NOT_PARTIAL_FILL_SAFE", "BEM order produces zero or overflowing consideration");
  const stepSeller = quantity / gcd(quantity, seller); const stepFee = fee === 0n ? 1n : quantity / gcd(quantity, fee); const fillStep = lcm(stepSeller, stepFee);
  return {
    baseAmountAtomic: quantity.toString(), baseAmountFormatted: formatUnits(quantity, input.baseDecimals),
    unitPriceQuoteAtomic: price.toString(), unitPriceQuoteFormatted: formatUnits(price, input.quoteDecimals),
    sellerQuoteTotalAtomic: seller.toString(), sellerQuoteTotalFormatted: formatUnits(seller, input.quoteDecimals),
    takerFeeQuoteAtomic: fee.toString(), takerFeeQuoteFormatted: formatUnits(fee, input.quoteDecimals),
    buyerQuoteTotalAtomic: (seller + fee).toString(), buyerQuoteTotalFormatted: formatUnits(seller + fee, input.quoteDecimals),
    fillStepBaseAtomic: fillStep.toString(), fillStepFormatted: formatUnits(fillStep, input.baseDecimals), minimumFillBaseAtomic: fillStep.toString(),
    makerFeeBps: 0, takerFeeBps: Number(feeBps), partialFillSafe: true,
  };
}
export function quoteBemFill(input: { fillAmountAtomic: string; totalBaseAmountAtomic: string; sellerQuoteTotalAtomic: string; feeQuoteTotalAtomic: string }) {
  const x = decimal(input.fillAmountAtomic, "INVALID_QUANTITY"); const q = decimal(input.totalBaseAmountAtomic, "INVALID_QUANTITY");
  if (x > q) throw new DomainError("INEXACT_PARTIAL_FILL", "Fill amount exceeds the original BEM amount");
  const seller = decimal(input.sellerQuoteTotalAtomic, "PRICE_NOT_PARTIAL_FILL_SAFE"); const fee = decimal(input.feeQuoteTotalAtomic, "PRICE_NOT_PARTIAL_FILL_SAFE");
  if (seller * x % q !== 0n || fee * x % q !== 0n) throw new DomainError("INEXACT_PARTIAL_FILL", "Fill amount does not match the order fill step");
  const divisor = gcd(x, q); const numerator = x / divisor; const denominator = q / divisor;
  return { numerator: numerator.toString(), denominator: denominator.toString(), sellerQuoteAmount: (seller * x / q).toString(), feeQuoteAmount: (fee * x / q).toString(), buyerQuoteAmount: ((seller + fee) * x / q).toString() };
}
