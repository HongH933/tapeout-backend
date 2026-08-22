import type { PublicClient } from "viem";
import type { AppConfig } from "../config.js";
import { DomainError } from "../domain/errors.js";
import type { ListingRecord, SignedListingInput } from "../domain/listing.js";
import { isCircuitListing } from "../domain/listing.js";
import { validateMarketplaceOrderShape } from "../domain/order-shape.js";
import { getOrderHash, verifyOrderSignature } from "../domain/signature.js";
import { circuitAbi, factoryAbi, processorAbi, seaportAbi, transistorsAbi, validatorAbi } from "./contracts.js";

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

export async function resolveAndValidateAsset(client: PublicClient, config: AppConfig, transistorsAddress: string, tokenId: string) {
  const processorAddress = await client.readContract({ address: address(transistorsAddress), abi: transistorsAbi, functionName: "circuits" });
  await validateAsset(client, config, processorAddress, transistorsAddress, tokenId);
  return processorAddress;
}

function validUint256Decimal(value: string) {
  if (!/^\d+$/.test(value)) return false;
  try { const parsed = BigInt(value); return parsed >= 0n && parsed <= (1n << 256n) - 1n; } catch { return false; }
}

export function circuitCollectionAllowed(config: AppConfig, collectionAddress: string) {
  return config.circuitCollections.some((allowed) => allowed.toLowerCase() === collectionAddress.toLowerCase());
}

export async function validateCircuitAsset(client: PublicClient, config: AppConfig, collectionAddress: string, tokenId: string) {
  if (!circuitCollectionAllowed(config, collectionAddress)) throw new DomainError("CIRCUIT_COLLECTION_NOT_ALLOWED", "Circuit collection is not supported");
  if (!validUint256Decimal(tokenId)) throw new DomainError("INVALID_ASSET", "Circuit token ID must be a uint256 decimal string");
  const code = await client.getCode({ address: address(collectionAddress) });
  if (!code || code === "0x") throw new DomainError("CIRCUIT_COLLECTION_NOT_ALLOWED", "Circuit collection has no bytecode");
  const erc721 = await client.readContract({ address: address(collectionAddress), abi: circuitAbi, functionName: "supportsInterface", args: ["0x80ac58cd"] }).catch(() => false);
  if (!erc721) throw new DomainError("CIRCUIT_COLLECTION_NOT_ALLOWED", "Allowlisted collection does not expose the ERC-721 interface");
  try {
    return await client.readContract({ address: address(collectionAddress), abi: circuitAbi, functionName: "ownerOf", args: [BigInt(tokenId)] });
  } catch (error) {
    throw new DomainError("CIRCUIT_NOT_FOUND", "Circuit token does not exist", 404, { cause: error instanceof Error ? error.message : "ownerOf failed" });
  }
}

export async function readCircuitApproval(client: PublicClient, config: AppConfig, collectionAddress: string, tokenId: string, owner: string) {
  const [approved, approvedForAll] = await Promise.all([
    client.readContract({ address: address(collectionAddress), abi: circuitAbi, functionName: "getApproved", args: [BigInt(tokenId)] }),
    client.readContract({ address: address(collectionAddress), abi: circuitAbi, functionName: "isApprovedForAll", args: [address(owner), address(config.seaportAddress)] }),
  ]);
  return { approved: approved.toLowerCase() === config.seaportAddress.toLowerCase(), approvedForAll, valid: approved.toLowerCase() === config.seaportAddress.toLowerCase() || approvedForAll };
}

export async function readListingWalletBalance(client: PublicClient, offerer: string, transistorsAddress: string, tokenId: string) {
  return (await client.readContract({ address: address(transistorsAddress), abi: transistorsAbi, functionName: "balanceOf", args: [address(offerer), BigInt(tokenId)] })).toString();
}

export async function validateSignedListing(client: PublicClient, config: AppConfig, input: SignedListingInput): Promise<ListingRecord> {
  if (!config.feeRecipient) throw new DomainError("WRITE_API_DISABLED", "FEE_RECIPIENT is not configured", 503);
  const offer = input.parameters.offer[0]; if (!offer) throw new DomainError("INVALID_STRUCTURE", "Missing offer");
  const assetStandard = input.assetStandard ?? "ERC1155";
  const collectionAddress = input.collectionAddress ?? offer.token;
  if (collectionAddress.toLowerCase() !== offer.token.toLowerCase()) throw new DomainError("INVALID_ASSET", "Collection address does not match the offered token");
  const circuitOwner = assetStandard === "ERC721" ? await validateCircuitAsset(client, config, collectionAddress, offer.identifierOrCriteria) : null;
  if (assetStandard === "ERC1155") await validateAsset(client, config, input.processorAddress, offer.token, offer.identifierOrCriteria);
  if (assetStandard === "ERC721" && input.processorAddress.toLowerCase() !== collectionAddress.toLowerCase()) throw new DomainError("INVALID_ASSET", "Circuit processor address must equal its collection address");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const math = validateMarketplaceOrderShape(input.parameters, { assetStandard, collectionAddress, tokenId: offer.identifierOrCriteria, feeRecipient: config.feeRecipient, now, maxDuration: BigInt(config.maxListingDurationSeconds) });
  const orderHash = getOrderHash(input.parameters);
  verifyOrderSignature(input.parameters, input.signature, config.chainId, config.seaportAddress);
  const [code, counter, inventory, approvalState, status, validatorCodes] = await Promise.all([
    client.getCode({ address: address(input.parameters.offerer) }),
    client.readContract({ address: address(config.seaportAddress), abi: seaportAbi, functionName: "getCounter", args: [address(input.parameters.offerer)] }),
    assetStandard === "ERC721" ? Promise.resolve(circuitOwner) : client.readContract({ address: address(offer.token), abi: transistorsAbi, functionName: "balanceOf", args: [address(input.parameters.offerer), BigInt(offer.identifierOrCriteria)] }),
    assetStandard === "ERC721" ? readCircuitApproval(client, config, collectionAddress, offer.identifierOrCriteria, input.parameters.offerer) : client.readContract({ address: address(offer.token), abi: transistorsAbi, functionName: "isApprovedForAll", args: [address(input.parameters.offerer), address(config.seaportAddress)] }),
    client.readContract({ address: address(config.seaportAddress), abi: seaportAbi, functionName: "getOrderStatus", args: [address(orderHash)] }),
    canonicalValidator(client, config, input),
  ]);
  if (code && code !== "0x") throw new DomainError("SMART_ACCOUNT_NOT_SUPPORTED", "EIP-1271 smart-account listings are not enabled in V1");
  if (counter.toString() !== input.parameters.counter) throw new DomainError("INVALID_COUNTER", "Order counter does not match Seaport counter");
  if (assetStandard === "ERC721" && String(inventory).toLowerCase() !== input.parameters.offerer.toLowerCase()) throw new DomainError("CIRCUIT_NOT_OWNER", "This wallet is no longer the owner", 409);
  if (assetStandard === "ERC1155" && typeof inventory === "bigint" && inventory < BigInt(offer.startAmount)) throw new DomainError("INVALID_BALANCE", "Seller balance is below listing quantity");
  const approval = typeof approvalState === "boolean" ? approvalState : approvalState.valid;
  if (!approval) throw new DomainError(assetStandard === "ERC721" ? "ERC721_APPROVAL_MISSING" : "INVALID_APPROVAL", "Seller has not approved Canonical Seaport");
  const [isValidated, isCancelled, totalFilled, totalSize] = status;
  if (isCancelled) throw new DomainError("ORDER_CANCELLED", "Order is cancelled"); if (totalSize > 0n && totalFilled >= totalSize) throw new DomainError("ORDER_FILLED", "Order is fully filled");
  const remaining = totalSize === 0n ? BigInt(offer.startAmount) : BigInt(offer.startAmount) * (totalSize - totalFilled) / totalSize;
  if (assetStandard === "ERC721" && totalFilled > 0n && totalSize > totalFilled) throw new DomainError("ERC721_PARTIAL_FILL_FORBIDDEN", "Circuit listings cannot be partially filled");
  const timestamp = new Date().toISOString();
  return { orderHash, chainId: config.chainId, seaportAddress: config.seaportAddress, offerer: input.parameters.offerer, processorAddress: input.processorAddress,
    assetStandard, collectionAddress, transistorsAddress: assetStandard === "ERC1155" ? offer.token : null, tokenId: offer.identifierOrCriteria, assetType: assetStandard === "ERC721" ? "CIRCUIT" : offer.identifierOrCriteria === "0" ? "NAND" : "LATCH", initialQuantity: offer.startAmount,
    remainingQuantity: remaining.toString(), ...math, parameters: input.parameters, signature: input.signature, status: assetStandard === "ERC721" ? "ACTIVE" : remaining < BigInt(offer.startAmount) ? "PARTIALLY_FILLED" : "ACTIVE",
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
  const [counter, inventory, approvalState, status, validatorCodes] = await Promise.all([
    client.readContract({ address: address(config.seaportAddress), abi: seaportAbi, functionName: "getCounter", args: [address(listing.offerer)] }),
    isCircuitListing(listing) ? client.readContract({ address: address(listing.collectionAddress), abi: circuitAbi, functionName: "ownerOf", args: [BigInt(listing.tokenId)] }).catch(() => "0x0000000000000000000000000000000000000000") : client.readContract({ address: address(offer.token), abi: transistorsAbi, functionName: "balanceOf", args: [address(listing.offerer), BigInt(listing.tokenId)] }),
    isCircuitListing(listing) ? readCircuitApproval(client, config, listing.collectionAddress, listing.tokenId, listing.offerer).catch(() => ({ approved: false, approvedForAll: false, valid: false })) : client.readContract({ address: address(offer.token), abi: transistorsAbi, functionName: "isApprovedForAll", args: [address(listing.offerer), address(config.seaportAddress)] }),
    client.readContract({ address: address(config.seaportAddress), abi: seaportAbi, functionName: "getOrderStatus", args: [address(listing.orderHash)] }),
    canonicalValidator(client, config, { processorAddress: listing.processorAddress, parameters: listing.parameters, signature: listing.signature, orderHash: listing.orderHash }, false),
  ]);
  const circuit = isCircuitListing(listing);
  const owner = circuit ? String(inventory) : null;
  const balance = circuit ? (owner?.toLowerCase() === listing.offerer.toLowerCase() ? 1n : 0n) : inventory as bigint;
  const approval = typeof approvalState === "boolean" ? approvalState : approvalState.valid;
  const [isValidated, isCancelled, totalFilled, totalSize] = status; const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  let next: ListingRecord["status"] = "ACTIVE";
  if (totalSize > 0n && totalFilled >= totalSize) next = "FILLED"; else if (isCancelled) next = "CANCELLED"; else if (BigInt(listing.endTime) <= nowSeconds) next = "EXPIRED"; else if (counter.toString() !== listing.parameters.counter) next = "INVALID_COUNTER";
  else if (circuit && totalFilled > 0n) next = "INVALID_STRUCTURE"; else if (circuit && owner?.toLowerCase() !== listing.offerer.toLowerCase()) next = "INVALID_OWNER";
  else if (!circuit && balance < BigInt(offer.startAmount) * (totalSize > 0n ? totalSize - totalFilled : 1n) / (totalSize || 1n)) next = "INVALID_BALANCE";
  else if (!approval || validatorCodes.errors.includes(401)) next = "INVALID_APPROVAL"; else if (validatorCodes.errors.includes(402)) next = "INVALID_BALANCE"; else if (validatorCodes.errors.length) next = "STALE"; else if (totalFilled > 0n) next = "PARTIALLY_FILLED";
  const remaining = next === "FILLED" ? 0n : circuit ? 1n : totalSize === 0n ? BigInt(listing.initialQuantity) : BigInt(listing.initialQuantity) * (totalSize - totalFilled) / totalSize;
  const timestamp = new Date().toISOString();
  const patch = { status: next, remainingQuantity: remaining.toString(), validationState: isValidated ? "ONCHAIN_VALIDATED" : "SIGNED_OFFCHAIN_VALID", validationDetails: { isValidated, totalFilled: totalFilled.toString(), totalSize: totalSize.toString(), canonicalValidator: "PASSED", balance: balance.toString(), owner, approval, counter: counter.toString() }, validatorCodes, lastValidatedAt: timestamp, updatedAt: timestamp } as const;
  return { patch, balance, approval, counter, isValidated, isCancelled, totalFilled, totalSize, validatorCodes };
}

function issueForStatus(status: ListingRecord["status"]) {
  if (status === "INVALID_BALANCE") return "INSUFFICIENT_SELLER_BALANCE";
  if (status === "INVALID_APPROVAL") return "INVALID_SELLER_APPROVAL";
  if (status === "INVALID_OWNER") return "INVALID_OWNER";
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
