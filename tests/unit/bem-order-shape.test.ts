import { describe, expect, it } from "vitest";
import { ItemType, OrderType } from "@opensea/seaport-js/lib/constants.js";
import { ZeroAddress, ZeroHash } from "ethers";
import { validateBemAskOrderShape } from "../../src/domain/order-shape.js";

const seller = "0x1111111111111111111111111111111111111111";
const bem = "0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a";
const usdt = "0x55d398326f99059fF775485246999027B3197955";
const feeRecipient = "0x3333333333333333333333333333333333333333";
const parameters = {
  offerer: seller,
  zone: ZeroAddress,
  offer: [{ itemType: ItemType.ERC20, token: bem, identifierOrCriteria: "0", startAmount: "100", endAmount: "100" }],
  consideration: [
    { itemType: ItemType.ERC20, token: usdt, identifierOrCriteria: "0", startAmount: "100", endAmount: "100", recipient: seller },
    { itemType: ItemType.ERC20, token: usdt, identifierOrCriteria: "0", startAmount: "1", endAmount: "1", recipient: feeRecipient },
  ],
  orderType: OrderType.PARTIAL_OPEN,
  startTime: "100",
  endTime: "200",
  zoneHash: ZeroHash,
  salt: "1",
  conduitKey: ZeroHash,
  totalOriginalConsiderationItems: "2",
  counter: "0",
};
const expected = { collectionAddress: bem, quoteTokenAddress: usdt, tokenId: "0", feeRecipient, now: 110n, maxDuration: 1_000n, baseDecimals: 0, quoteDecimals: 0 };

describe("BEM ERC-20 Seaport order shape", () => {
  it("accepts one BEM offer, two USDT recipients, PARTIAL_OPEN and exact 0/1% fees", () => {
    expect(validateBemAskOrderShape(parameters, expected)).toMatchObject({ fillStepBaseAtomic: "100", makerFeeBps: 0, takerFeeBps: 100 });
  });

  it("rejects native consideration, the wrong side and non-partial order types", () => {
    expect(() => validateBemAskOrderShape({ ...parameters, consideration: [{ ...parameters.consideration[0]!, itemType: ItemType.NATIVE, token: ZeroAddress }, parameters.consideration[1]!] }, expected)).toThrowError(/USDT ERC-20/);
    expect(() => validateBemAskOrderShape({ ...parameters, orderType: OrderType.FULL_OPEN }, expected)).toThrowError(/PARTIAL_OPEN/);
    expect(() => validateBemAskOrderShape({ ...parameters, offer: [{ ...parameters.offer[0]!, token: usdt }] }, expected)).toThrowError(/configured token/);
  });
});
