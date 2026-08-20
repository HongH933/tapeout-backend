export const factoryAbi = [
  { type: "function", name: "isCPU", stateMutability: "view", inputs: [{ name: "cpu", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "event", name: "CPUCreated", inputs: [{ indexed: true, name: "circuits", type: "address" }, { indexed: true, name: "transistors", type: "address" }, { indexed: true, name: "creator", type: "address" }, { indexed: false, name: "name", type: "string" }, { indexed: false, name: "supply", type: "uint256" }, { indexed: false, name: "mintPrice", type: "uint256" }] },
] as const;
export const processorAbi = [{ type: "function", name: "transistors", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
export const transistorsAbi = [
  { type: "function", name: "circuits", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] },
] as const;
export const seaportAbi = [
  { type: "function", name: "getCounter", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOrderStatus", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool", name: "isValidated" }, { type: "bool", name: "isCancelled" }, { type: "uint256", name: "totalFilled" }, { type: "uint256", name: "totalSize" }] },
  { type: "event", name: "OrderFulfilled", inputs: [{ indexed: false, name: "orderHash", type: "bytes32" }, { indexed: true, name: "offerer", type: "address" }, { indexed: true, name: "zone", type: "address" }, { indexed: false, name: "recipient", type: "address" }, { indexed: false, name: "offer", type: "tuple[]", components: [{ name: "itemType", type: "uint8" }, { name: "token", type: "address" }, { name: "identifier", type: "uint256" }, { name: "amount", type: "uint256" }] }, { indexed: false, name: "consideration", type: "tuple[]", components: [{ name: "itemType", type: "uint8" }, { name: "token", type: "address" }, { name: "identifier", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "recipient", type: "address" }] }] },
  { type: "event", name: "OrderCancelled", inputs: [{ indexed: false, name: "orderHash", type: "bytes32" }, { indexed: true, name: "offerer", type: "address" }, { indexed: true, name: "zone", type: "address" }] },
  { type: "event", name: "CounterIncremented", inputs: [{ indexed: false, name: "newCounter", type: "uint256" }, { indexed: true, name: "offerer", type: "address" }] },
] as const;
const offerComponents = [{ name: "itemType", type: "uint8" }, { name: "token", type: "address" }, { name: "identifierOrCriteria", type: "uint256" }, { name: "startAmount", type: "uint256" }, { name: "endAmount", type: "uint256" }] as const;
const considerationComponents = [...offerComponents, { name: "recipient", type: "address" }] as const;
const orderParameterComponents = [
  { name: "offerer", type: "address" }, { name: "zone", type: "address" },
  { name: "offer", type: "tuple[]", components: offerComponents }, { name: "consideration", type: "tuple[]", components: considerationComponents },
  { name: "orderType", type: "uint8" }, { name: "startTime", type: "uint256" }, { name: "endTime", type: "uint256" },
  { name: "zoneHash", type: "bytes32" }, { name: "salt", type: "uint256" }, { name: "conduitKey", type: "bytes32" }, { name: "totalOriginalConsiderationItems", type: "uint256" },
] as const;
export const validatorAbi = [{
  type: "function", name: "isValidOrderWithConfiguration", stateMutability: "view",
  inputs: [
    { name: "validationConfiguration", type: "tuple", components: [{ name: "seaport", type: "address" }, { name: "primaryFeeRecipient", type: "address" }, { name: "primaryFeeBips", type: "uint256" }, { name: "checkCreatorFee", type: "bool" }, { name: "skipStrictValidation", type: "bool" }, { name: "shortOrderDuration", type: "uint256" }, { name: "distantOrderExpiration", type: "uint256" }] },
    { name: "order", type: "tuple", components: [{ name: "parameters", type: "tuple", components: orderParameterComponents }, { name: "signature", type: "bytes" }] },
  ],
  outputs: [{ name: "errorsAndWarnings", type: "tuple", components: [{ name: "errors", type: "uint16[]" }, { name: "warnings", type: "uint16[]" }] }],
}] as const;
export const seaportOrderValidatedAbi = [{ type: "event", name: "OrderValidated", inputs: [{ indexed: false, name: "orderHash", type: "bytes32" }, { indexed: false, name: "orderParameters", type: "tuple", components: orderParameterComponents }] }] as const;
