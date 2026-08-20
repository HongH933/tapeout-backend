import { describe, expect, it } from "vitest";
import { quoteFill, quoteOrder, UINT256_MAX } from "../../src/domain/order-math.js";

describe("Maker 0 / taker 1 percent integer math", () => {
  it("quotes one and two units", () => {
    expect(quoteOrder("10000", "1")).toMatchObject({ sellerTotalWei: "10000", feeTotalWei: "100", buyerTotalWei: "10100" });
    expect(quoteOrder("10000", "2")).toMatchObject({ sellerTotalWei: "20000", feeTotalWei: "200", buyerTotalWei: "20200" });
  });
  it("keeps partial and remaining fills exactly additive", () => {
    const partial = quoteFill("10000", "3"); const remaining = quoteFill("10000", "7"); const whole = quoteFill("10000", "10");
    expect(BigInt(partial.buyerPaymentWei) + BigInt(remaining.buyerPaymentWei)).toBe(BigInt(whole.buyerPaymentWei));
  });
  it("rejects non-divisible and tiny prices", () => {
    expect(() => quoteOrder("101", "1")).toThrowError(/exact per-unit fee/);
    expect(() => quoteOrder("99", "1")).toThrowError(/exact per-unit fee/);
  });
  it("supports large quantities and rejects uint256 overflow", () => {
    expect(quoteOrder("10000", "1000000000000000000000000").quantity).toBe("1000000000000000000000000");
    expect(() => quoteOrder(UINT256_MAX.toString(), "2")).toThrowError(/uint256/);
  });
});
