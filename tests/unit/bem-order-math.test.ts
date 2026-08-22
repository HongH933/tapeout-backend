import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/domain/errors.js";
import { gcd, lcm, quoteBemAsk, quoteBemFill } from "../../src/domain/bem-order-math.js";

describe("BEM/USDT exact order math", () => {
  it("uses bigint gcd/lcm and returns the minimum safe partial-fill step", () => {
    expect(gcd(84n, 30n)).toBe(6n);
    expect(lcm(21n, 6n)).toBe(42n);
    const quote = quoteBemAsk({ baseAmountAtomic: "100", unitPriceQuoteAtomic: "1", baseDecimals: 0, quoteDecimals: 0 });
    expect(quote).toMatchObject({
      sellerQuoteTotalAtomic: "100",
      takerFeeQuoteAtomic: "1",
      buyerQuoteTotalAtomic: "101",
      fillStepBaseAtomic: "100",
      minimumFillBaseAtomic: "100",
      makerFeeBps: 0,
      takerFeeBps: 100,
      partialFillSafe: true,
    });
  });

  it("reduces AdvancedOrder fractions and rejects dust/inexact fills", () => {
    const full = quoteBemFill({ fillAmountAtomic: "100", totalBaseAmountAtomic: "100", sellerQuoteTotalAtomic: "100", feeQuoteTotalAtomic: "1" });
    expect(full).toEqual({ numerator: "1", denominator: "1", sellerQuoteAmount: "100", feeQuoteAmount: "1", buyerQuoteAmount: "101" });
    expect(() => quoteBemFill({ fillAmountAtomic: "1", totalBaseAmountAtomic: "100", sellerQuoteTotalAtomic: "100", feeQuoteTotalAtomic: "1" })).toThrow(DomainError);
  });

  it("rejects any silent division rounding in seller proceeds or the 1% fee", () => {
    expect(() => quoteBemAsk({ baseAmountAtomic: "1", unitPriceQuoteAtomic: "1", baseDecimals: 8, quoteDecimals: 18 })).toThrowError(/exact USDT proceeds/);
    expect(() => quoteBemAsk({ baseAmountAtomic: "100000000", unitPriceQuoteAtomic: "1", baseDecimals: 8, quoteDecimals: 18 })).toThrowError(/exact taker fee/);
  });
});
