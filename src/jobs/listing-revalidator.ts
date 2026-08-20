import type { PublicClient } from "viem";
import type { AppConfig } from "../config.js";
import type { ListingRepository } from "../db/repository.js";
import { revalidateListing } from "../chain/validation.js";

export async function revalidateBatch(repository: ListingRepository, client: PublicClient, config: AppConfig) {
  const listings = await repository.list({ statuses: ["ACTIVE", "PARTIALLY_FILLED", "INVALID_BALANCE", "INVALID_APPROVAL", "STALE"], limit: 100 });
  for (const listing of listings) {
    try { await repository.updateValidation(listing.orderHash, await revalidateListing(client, config, listing)); }
    catch (error) { await repository.updateValidation(listing.orderHash, { status: "STALE", validationState: "RPC_ERROR", validationDetails: { message: error instanceof Error ? error.message : "Unknown RPC error" }, lastValidatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }
  }
  return listings.length;
}
