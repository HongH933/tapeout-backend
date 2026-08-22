import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { loadConfig } from "../../src/config.js";
import { circuitCollectionAllowed, readCircuitApproval, validateCircuitAsset } from "../../src/chain/validation.js";

const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://local/test", BSC_RPC_HTTP_URL: "http://localhost:8545", FEE_RECIPIENT: "0x3333333333333333333333333333333333333333", CHAIN_STARTUP_CHECK: "false" });
const tapeout = config.circuitCollections[0]!;

describe("Circuit collection and approval validation", () => {
  it("allows only the two fixed Circuit collections", () => {
    expect(config.circuitCollections).toHaveLength(2);
    expect(circuitCollectionAllowed(config, tapeout)).toBe(true);
    expect(circuitCollectionAllowed(config, "0x1111111111111111111111111111111111111111")).toBe(false);
  });
  it("requires bytecode, ERC721 support, and an existing owner", async () => {
    const client = { getCode: async () => "0x1234", readContract: async ({ functionName }: { functionName: string }) => functionName === "supportsInterface" ? true : "0x1111111111111111111111111111111111111111" } as unknown as PublicClient;
    await expect(validateCircuitAsset(client, config, tapeout, "42")).resolves.toBe("0x1111111111111111111111111111111111111111");
    await expect(validateCircuitAsset(client, config, "0x1111111111111111111111111111111111111111", "42")).rejects.toMatchObject({ code: "CIRCUIT_COLLECTION_NOT_ALLOWED" });
    await expect(validateCircuitAsset({ ...client, getCode: async () => "0x" } as unknown as PublicClient, config, tapeout, "42")).rejects.toMatchObject({ code: "CIRCUIT_COLLECTION_NOT_ALLOWED" });
  });
  it("accepts either single-token approval or approval-for-all", async () => {
    const single = { readContract: async ({ functionName }: { functionName: string }) => functionName === "getApproved" ? config.seaportAddress : false } as unknown as PublicClient;
    const all = { readContract: async ({ functionName }: { functionName: string }) => functionName === "getApproved" ? "0x0000000000000000000000000000000000000000" : true } as unknown as PublicClient;
    expect((await readCircuitApproval(single, config, tapeout, "42", "0x1111111111111111111111111111111111111111")).valid).toBe(true);
    expect((await readCircuitApproval(all, config, tapeout, "42", "0x1111111111111111111111111111111111111111")).valid).toBe(true);
  });
});
