import { describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { PublicClient } from "viem";
import type { AppConfig } from "../../src/config.js";
import { PostgresListingRepository } from "../../src/db/postgres-repository.js";
import { decodeMarketCursor, type ListingRepository } from "../../src/db/repository.js";
import { CIRCUIT_RESERVING_LISTING_STATUSES } from "../../src/domain/listing.js";
import { revalidateBatch } from "../../src/jobs/listing-revalidator.js";

describe("Circuit production regressions", () => {
  it("keeps invalid-owner orders reserved and eligible for revalidation", async () => {
    expect(CIRCUIT_RESERVING_LISTING_STATUSES).toContain("INVALID_OWNER");
    const list = vi.fn().mockResolvedValue([]);
    const repository = { list } as unknown as ListingRepository;
    await revalidateBatch(repository, {} as PublicClient, {} as AppConfig);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ statuses: expect.arrayContaining(["INVALID_OWNER"]) }));
  });

  it("rejects malformed Circuit pagination cursors as a client error", async () => {
    const query = vi.fn();
    const repository = new PostgresListingRepository({ query } as unknown as pg.Pool);
    await expect(repository.listCircuitPage({
      collectionAddress: "0xb1024b89886B9a34Aa4ff5F31C411D708b20a14C",
      statuses: ["ACTIVE"],
      limit: 24,
      cursor: "not-a-valid-cursor",
      sort: "price_asc",
    })).rejects.toMatchObject({ code: "INVALID_CURSOR", statusCode: 400 });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects structurally invalid cursor fields before querying PostgreSQL", async () => {
    const query = vi.fn();
    const repository = new PostgresListingRepository({ query } as unknown as pg.Pool);
    const cursor = Buffer.from(JSON.stringify({ sort: "price_asc", value: "not-a-number", orderHash: 7 }), "utf8").toString("base64url");
    await expect(repository.listCircuitPage({
      collectionAddress: "0xb1024b89886B9a34Aa4ff5F31C411D708b20a14C",
      statuses: ["ACTIVE"],
      limit: 24,
      cursor,
      sort: "price_asc",
    })).rejects.toMatchObject({ code: "INVALID_CURSOR", statusCode: 400 });
    expect(query).not.toHaveBeenCalled();
    expect(() => decodeMarketCursor("not-a-valid-cursor")).toThrow(expect.objectContaining({ code: "INVALID_CURSOR", statusCode: 400 }));
  });
});
