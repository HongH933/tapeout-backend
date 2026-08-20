import { TypedDataEncoder, verifyTypedData, type TypedDataField } from "ethers";
import type { OrderParameters } from "./listing.js";
import { DomainError } from "./errors.js";

export const ORDER_TYPES: Record<string, TypedDataField[]> = {
  OfferItem: [
    { name: "itemType", type: "uint8" }, { name: "token", type: "address" }, { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" }, { name: "endAmount", type: "uint256" },
  ],
  ConsiderationItem: [
    { name: "itemType", type: "uint8" }, { name: "token", type: "address" }, { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" }, { name: "endAmount", type: "uint256" }, { name: "recipient", type: "address" },
  ],
  OrderComponents: [
    { name: "offerer", type: "address" }, { name: "zone", type: "address" }, { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" }, { name: "orderType", type: "uint8" }, { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" }, { name: "zoneHash", type: "bytes32" }, { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" }, { name: "counter", type: "uint256" },
  ],
};

export function getOrderHash(parameters: OrderParameters) {
  return TypedDataEncoder.hashStruct("OrderComponents", ORDER_TYPES, parameters);
}

export function verifyOrderSignature(parameters: OrderParameters, signature: string, chainId: number, seaportAddress: string) {
  try {
    const signer = verifyTypedData({ name: "Seaport", version: "1.6", chainId, verifyingContract: seaportAddress }, ORDER_TYPES, parameters, signature);
    if (signer.toLowerCase() !== parameters.offerer.toLowerCase()) throw new DomainError("INVALID_SIGNATURE", "Recovered signer does not match offerer");
    return signer;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("INVALID_SIGNATURE", "Invalid Seaport EIP-712 signature");
  }
}
