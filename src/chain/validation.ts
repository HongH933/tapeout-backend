import type { PublicClient } from "viem";
import type { AppConfig } from "../config.js";
import { DomainError } from "../domain/errors.js";
import type { ListingRecord, SignedListingInput } from "../domain/listing.js";
import { validateOrderShape } from "../domain/order-shape.js";
import { getOrderHash, verifyOrderSignature } from "../domain/signature.js";
import { factoryAbi, processorAbi, seaportAbi, transistorsAbi, validatorAbi } from "./contracts.js";

const address = (value: string) => value as `0x${string}`;
function validatorOrder(parameters: SignedListingInput["parameters"], signature: string) {
  const { counter, ...orderParameters } = parameters;
  void counter;
  const numericItem = (item: any) => ({ ...item, identifierOrCriteria: BigInt(item.identifierOrCriteria), startAmount: BigInt(item.startAmount), endAmount: BigInt(item.endAmount) });
  return { parameters: { ...orderParameters, offer: parameters.offer.map(numericItem), consideration: parameters.consideration.map(numericItem), startTime: BigInt(parameters.startTime), endTime: BigInt(parameters.endTime), salt: BigInt(parameters.salt), totalOriginalConsiderationItems: BigInt(parameters.totalOriginalConsiderationItems) }, signature };
}
export async function canonicalValidator(client: PublicClient, config: AppConfig, input: SignedListingInput, rejectOnError = true) {
  if (!config.feeRecipient) throw new DomainError("WRITE_API_DISABLED", "FEE_RECIPIENT is not configured", 503);
  const result = await client.readContract({ address: address(config.validatorAddress), abi: validatorAbi, functionName: "isValidOrderWithConfiguration", args: [{ seaport: address(config.seaportAddress), primaryFeeRecipient: address(config.feeRecipient), primaryFeeBips: 100n, checkCreatorFee: false, skipStrictValidation: false, shortOrderDuration: 0n, distantOrderExpiration: BigInt(config.maxListingDurationSeconds) }, validatorOrder(input.parameters, input.signature) as any] });
  const codes = { errors: [...result.errors].map(Number), warnings: [...result.warnings].map(Number) }; if (rejectOnError && codes.errors.length) throw new DomainError("VALIDATOR_REJECTED", "Canonical Seaport Validator rejected the order", 400, codes); return codes;
}
export async function validateAsset(client: PublicClient, config: AppConfig, processorAddress: string, transistorsAddress: string, tokenId: string) {
  if (tokenId !== "0" && tokenId !== "1") throw new DomainError("INVALID_ASSET", "Only NAND token 0 and LATCH token 1 are supported");
  const [isCpu, linkedTransistors, linkedProcessor, erc1155] = await Promise.all([
    client.readContract({ address: address(config.factoryAddress), abi: factoryAbi, functionName: "isCPU", args: [address(processorAddress)] }),
    client.readContract({ address: address(processorAddress), abi: processorAbi, functionName: "transistors" }),
    client.readContract({ address: address(transistorsAddress), abi: transistorsAbi, functionName: "circuits" }),
    client.readContract({ address: address(transistorsAddress), abi: transistorsAbi, functionName: "supportsInterface", args: ["0xd9b67a26"] }),
  ]);
  if (!isCpu || linkedTransistors.toLowerCase() !== transistorsAddress.toLowerCase() || linkedProcessor.toLowerCase() !== processorAddress.toLowerCase() || !erc1155) throw new DomainError("INVALID_ASSET", "Factory, Processor and Transistors relationship is invalid");
}

export async function validateSignedListing(client: PublicClient, config: AppConfig, input: SignedListingInput): Promise<ListingRecord> {
  if (!config.feeRecipient) throw new DomainError("WRITE_API_DISABLED", "FEE_RECIPIENT is not configured", 503);
  const offer = input.parameters.offer[0]; if (!offer) throw new DomainError("INVALID_STRUCTURE", "Missing offer");
  await validateAsset(client, config, input.processorAddress, offer.token, offer.identifierOrCriteria);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const math = validateOrderShape(input.parameters, { transistorsAddress: offer.token, tokenId: offer.identifierOrCriteria, feeRecipient: config.feeRecipient, now, maxDuration: BigInt(config.maxListingDurationSeconds) });
  const orderHash = getOrderHash(input.parameters);
  verifyOrderSignature(input.parameters, input.signature, config.chainId, config.seaportAddress);
  const [code, counter, balance, approval, status, validatorCodes] = await Promise.all([
    client.getCode({ address: address(input.parameters.offerer) }),
    client.readContract({ address: address(config.seaportAddress), abi: seaportAbi, functionName: "getCounter", args: [address(input.parameters.offerer)] }),
    client.readContract({ address: address(offer.token), abi: transistorsAbi, functionName: "balanceOf", args: [address(input.parameters.offerer), BigInt(offer.identifierOrCriteria)] }),
    client.readContract({ address: address(offer.token), abi: transistorsAbi, functionName: "isApprovedForAll", args: [address(input.parameters.offerer), address(config.seaportAddress)] }),
    client.readContract({ address: address(config.seaportAddress), abi: seaportAbi, functionName: "getOrderStatus", args: [address(orderHash)] }),
    canonicalValidator(client, config, input),
  ]);
  if (code && code !== "0x") throw new DomainError("SMART_ACCOUNT_NOT_SUPPORTED", "EIP-1271 smart-account listings are not enabled in V1");
  if (counter.toString() !== input.parameters.counter) throw new DomainError("INVALID_COUNTER", "Order counter does not match Seaport counter");
  if (balance < BigInt(offer.startAmount)) throw new DomainError("INVALID_BALANCE", "Seller balance is below listing quantity");
  if (!approval) throw new DomainError("INVALID_APPROVAL", "Seller has not approved Canonical Seaport");
  const [isValidated, isCancelled, totalFilled, totalSize] = status;
  if (isCancelled) throw new DomainError("ORDER_CANCELLED", "Order is cancelled"); if (totalSize > 0n && totalFilled >= totalSize) throw new DomainError("ORDER_FILLED", "Order is fully filled");
  const remaining = totalSize === 0n ? BigInt(offer.startAmount) : BigInt(offer.startAmount) * (totalSize - totalFilled) / totalSize;
  const timestamp = new Date().toISOString();
  return { orderHash, chainId: config.chainId, seaportAddress: config.seaportAddress, offerer: input.parameters.offerer, processorAddress: input.processorAddress,
    transistorsAddress: offer.token, tokenId: offer.identifierOrCriteria, assetType: offer.identifierOrCriteria === "0" ? "NAND" : "LATCH", initialQuantity: offer.startAmount,
    remainingQuantity: remaining.toString(), ...math, parameters: input.parameters, signature: input.signature, status: remaining < BigInt(offer.startAmount) ? "PARTIALLY_FILLED" : "ACTIVE",
    validationState: isValidated ? "ONCHAIN_VALIDATED" : "SIGNED_OFFCHAIN_VALID", validationDetails: { isValidated, totalFilled: totalFilled.toString(), totalSize: totalSize.toString(), canonicalValidator: "PASSED" },
    validatorCodes, startTime: input.parameters.startTime, endTime: input.parameters.endTime, createdAt: timestamp, updatedAt: timestamp, lastValidatedAt: timestamp };
}

export type ListingInspection = {
  listing: ListingRecord;
  patch: Awaited<ReturnType<typeof inspectListingPatch>>["patch"];
  balance: string;
  approval: boolean;
  counter: string;
  orderStatus: { isValidated: boolean; isCancelled: boolean; totalFilled: string; totalSize: string };
  validatorResult: { errors: number[]; warnings: number[] };
  issueCode: string | null;
};

async function inspectListingPatch(client: PublicClient, config: AppConfig, listing: ListingRecord) {
  const offer = listing.parameters.offer[0]!;
  const [counter, balance, approval, status, validatorCodes] = await Promise.all([
    client.readContract({ address: address(config.seaportAddress), abi: seaportAbi, functionName: "getCounter", args: [address(listing.offerer)] }),
    client.readContract({ address: address(offer.token), abi: transistorsAbi, functionName: "balanceOf", args: [address(listing.offerer), BigInt(listing.tokenId)] }),
    client.readContract({ address: address(offer.token), abi: transistorsAbi, functionName: "isApprovedForAll", args: [address(listing.offerer), address(config.seaportAddress)] }),
    client.readContract({ address: address(config.seaportAddress), abi: seaportAbi, functionName: "getOrderStatus", args: [address(listing.orderHash)] }),
    canonicalValidator(client, config, { processorAddress: listing.processorAddress, parameters: listing.parameters, signature: listing.signature, orderHash: listing.orderHash }, false),
  ]);
  const [isValidated, isCancelled, totalFilled, totalSize] = status; const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  let next: ListingRecord["status"] = "ACTIVE";
  if (isCancelled) next = "CANCELLED"; else if (BigInt(listing.endTime) <= nowSeconds) next = "EXPIRED"; else if (counter.toString() !== listing.parameters.counter) next = "INVALID_COUNTER";
  else if (totalSize > 0n && totalFilled >= totalSize) next = "FILLED"; else if (balance < BigInt(offer.startAmount) * (totalSize > 0n ? totalSize - totalFilled : 1n) / (totalSize || 1n)) next = "INVALID_BALANCE";
  else if (!approval || validatorCodes.errors.includes(401)) next = "INVALID_APPROVAL"; else if (validatorCodes.errors.includes(402)) next = "INVALID_BALANCE"; else if (validatorCodes.errors.length) next = "STALE"; else if (totalFilled > 0n) next = "PARTIALLY_FILLED";
  const remaining = totalSize === 0n ? BigInt(listing.initialQuantity) : BigInt(listing.initialQuantity) * (totalSize - totalFilled) / totalSize;
  const timestamp = new Date().toISOString();
  const patch = { status: next, remainingQuantity: remaining.toString(), validationState: isValidated ? "ONCHAIN_VALIDATED" : "SIGNED_OFFCHAIN_VALID", validationDetails: { isValidated, totalFilled: totalFilled.toString(), totalSize: totalSize.toString(), canonicalValidator: "PASSED", balance: balance.toString(), approval, counter: counter.toString() }, validatorCodes, lastValidatedAt: timestamp, updatedAt: timestamp } as const;
  return { patch, balance, approval, counter, isValidated, isCancelled, totalFilled, totalSize, validatorCodes };
}

function issueForStatus(status: ListingRecord["status"]) {
  if (status === "INVALID_BALANCE") return "INSUFFICIENT_SELLER_BALANCE";
  if (status === "INVALID_APPROVAL") return "INVALID_SELLER_APPROVAL";
  if (status === "CANCELLED") return "ORDER_CANCELLED";
  if (status === "FILLED") return "ORDER_FILLED";
  if (status === "EXPIRED") return "ORDER_EXPIRED";
  if (status === "ACTIVE" || status === "PARTIALLY_FILLED") return null;
  return "LISTING_NOT_FILLABLE";
}

export async function inspectListing(client: PublicClient, config: AppConfig, listing: ListingRecord): Promise<ListingInspection> {
  const result = await inspectListingPatch(client, config, listing);
  return {
    listing,
    patch: result.patch,
    balance: result.balance.toString(),
    approval: result.approval,
    counter: result.counter.toString(),
    orderStatus: { isValidated: result.isValidated, isCancelled: result.isCancelled, totalFilled: result.totalFilled.toString(), totalSize: result.totalSize.toString() },
    validatorResult: result.validatorCodes,
    issueCode: issueForStatus(result.patch.status),
  };
}

export async function inspectListings(client: PublicClient, config: AppConfig, listings: ListingRecord[], concurrency = config.batchRevalidationConcurrency) {
  const results: ListingInspection[] = [];
  for (let index = 0; index < listings.length; index += concurrency) {
    results.push(...await Promise.all(listings.slice(index, index + concurrency).map((listing) => inspectListing(client, config, listing))));
  }
  return results;
}

export async function revalidateListing(client: PublicClient, config: AppConfig, listing: ListingRecord) {
  return (await inspectListing(client, config, listing)).patch;
}
