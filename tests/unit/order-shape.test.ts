import { describe, expect, it } from "vitest";
import { ZeroAddress, ZeroHash } from "ethers";
import { validateCircuitOrderShape, validateOrderShape } from "../../src/domain/order-shape.js";

const seller = "0x1111111111111111111111111111111111111111"; const token = "0x2222222222222222222222222222222222222222"; const fee = "0x3333333333333333333333333333333333333333";
const parameters = { offerer: seller, zone: ZeroAddress, offer: [{ itemType: 3, token, identifierOrCriteria: "0", startAmount: "10", endAmount: "10" }], consideration: [{ itemType: 0, token: ZeroAddress, identifierOrCriteria: "0", startAmount: "100000", endAmount: "100000", recipient: seller }, { itemType: 0, token: ZeroAddress, identifierOrCriteria: "0", startAmount: "1000", endAmount: "1000", recipient: fee }], orderType: 1, startTime: "1000", endTime: "2000", zoneHash: ZeroHash, salt: "1", conduitKey: ZeroHash, totalOriginalConsiderationItems: "2", counter: "0" };
describe("strict listing shape", () => {
  it("accepts one ERC1155 and two native recipients", () => expect(validateOrderShape(parameters, { transistorsAddress: token, tokenId: "0", feeRecipient: fee, now: 1100n, maxDuration: 3000n }).buyerTotalWei).toBe("101000"));
  it("rejects wrong fee recipient and fee", () => {
    expect(() => validateOrderShape({ ...parameters, consideration: [parameters.consideration[0]!, { ...parameters.consideration[1]!, recipient: seller }] }, { transistorsAddress: token, tokenId: "0", feeRecipient: fee, now: 1100n, maxDuration: 3000n })).toThrow(/recipients/);
    expect(() => validateOrderShape({ ...parameters, consideration: [parameters.consideration[0]!, { ...parameters.consideration[1]!, startAmount: "900", endAmount: "900" }] }, { transistorsAddress: token, tokenId: "0", feeRecipient: fee, now: 1100n, maxDuration: 3000n })).toThrow(/math/);
  });
  it("rejects multi-offer, WBNB, wrong token and expired orders", () => {
    expect(() => validateOrderShape({ ...parameters, offer: [...parameters.offer, parameters.offer[0]!] }, { transistorsAddress: token, tokenId: "0", feeRecipient: fee, now: 1100n, maxDuration: 3000n })).toThrow(/one offer/);
    expect(() => validateOrderShape({ ...parameters, consideration: [{ ...parameters.consideration[0]!, itemType: 1, token }, parameters.consideration[1]!] }, { transistorsAddress: token, tokenId: "0", feeRecipient: fee, now: 1100n, maxDuration: 3000n })).toThrow(/native/);
    expect(() => validateOrderShape(parameters, { transistorsAddress: token, tokenId: "1", feeRecipient: fee, now: 1100n, maxDuration: 3000n })).toThrow(/TapeOut/);
    expect(() => validateOrderShape(parameters, { transistorsAddress: token, tokenId: "0", feeRecipient: fee, now: 3000n, maxDuration: 3000n })).toThrow(/active/);
  });
});

describe("Circuit ERC721 listing shape", () => {
  const circuit = { ...parameters, offer: [{ ...parameters.offer[0]!, itemType: 2, identifierOrCriteria: "42", startAmount: "1", endAmount: "1" }], consideration: [{ ...parameters.consideration[0]!, startAmount: "100000", endAmount: "100000" }, { ...parameters.consideration[1]!, startAmount: "1000", endAmount: "1000" }], orderType: 0 };
  const expected = { collectionAddress: token, tokenId: "42", feeRecipient: fee, now: 1100n, maxDuration: 3000n };
  it("accepts FULL_OPEN ERC721 amount one with exact one percent taker fee", () => expect(validateCircuitOrderShape(circuit, expected).buyerTotalWei).toBe("101000"));
  it("rejects partial order types and quantities", () => {
    expect(() => validateCircuitOrderShape({ ...circuit, orderType: 1 }, expected)).toThrow(/FULL_OPEN/);
    expect(() => validateCircuitOrderShape({ ...circuit, offer: [{ ...circuit.offer[0]!, startAmount: "2", endAmount: "2" }] }, expected)).toThrow(/partially/);
  });
});
