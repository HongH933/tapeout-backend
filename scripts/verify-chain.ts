import { readFile } from "node:fs/promises";
import { createPublicClient, encodeFunctionData, encodePacked, getAddress, http, keccak256 } from "viem";
import { bsc } from "viem/chains";
import { loadConfig } from "../src/config.js";

const erc721Abi = [
  { type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "nextId", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "getApproved", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "circuitInfo", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint32" }, { type: "uint32" }, { type: "uint32" }, { type: "uint32" }] },
] as const;
const miningReadAbi = [{ type: "function", name: "getMiner", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [] }, { type: "function", name: "pending", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [] }] as const;

async function main() {
  const config = loadConfig(); const client = createPublicClient({ chain: bsc, transport: http(config.rpcUrls[0], { timeout: 15_000 }) });
  if (await client.getChainId() !== 56 || config.chainId !== 56) throw new Error("CHAIN_ID_MISMATCH");
  for (const value of config.circuitCollections) {
    const address = getAddress(value); const code = await client.getBytecode({ address }); if (!code || code === "0x") throw new Error(`${address}:NO_BYTECODE`);
    const [supported, name, symbol, nextId] = await Promise.all([client.readContract({ address, abi: erc721Abi, functionName: "supportsInterface", args: ["0x80ac58cd"] }), client.readContract({ address, abi: erc721Abi, functionName: "name" }), client.readContract({ address, abi: erc721Abi, functionName: "symbol" }), client.readContract({ address, abi: erc721Abi, functionName: "nextId" })]);
    if (!supported || nextId === 0n) throw new Error(`${address}:ERC721_CHECK_FAILED`); const tokenId = nextId - 1n;
    const owner = await client.readContract({ address, abi: erc721Abi, functionName: "ownerOf", args: [tokenId] });
    await Promise.all([client.readContract({ address, abi: erc721Abi, functionName: "getApproved", args: [tokenId] }), client.readContract({ address, abi: erc721Abi, functionName: "isApprovedForAll", args: [owner, config.seaportAddress] }), client.readContract({ address, abi: erc721Abi, functionName: "circuitInfo", args: [tokenId] })]);
    const key = keccak256(encodePacked(["address", "uint256"], [address, tokenId]));
    const [miner, pending] = await Promise.all(["getMiner", "pending"].map((functionName) => client.call({ to: config.podMiningAddress as `0x${string}`, data: encodeFunctionData({ abi: miningReadAbi, functionName: functionName as "getMiner" | "pending", args: [key] }) })));
    if (!miner.data || miner.data === "0x" || !pending.data || pending.data === "0x") throw new Error(`${address}:POD_MINING_READ_FAILED`);
    console.log(`${name} (${symbol}) #${tokenId} owner ${owner} OK`);
  }
  for (const [label, address] of [["Seaport", config.seaportAddress], ["Validator", config.validatorAddress], ["PodMining", config.podMiningAddress]] as const) { const code = await client.getBytecode({ address: getAddress(address) }); if (!code || code === "0x") throw new Error(`${label}:NO_BYTECODE`); }
  const migration = await readFile(new URL("../migrations/0002_circuit_listings.sql", import.meta.url), "utf8");
  for (const field of ["asset_standard", "collection_address", "ERC721", "CIRCUIT"]) if (!migration.includes(field)) throw new Error(`MIGRATION_FIELD_MISSING:${field}`);
  console.log(`Fee recipient: ${config.feeRecipient ?? "NOT CONFIGURED (writes fail closed)"}`);
  console.log("Chain contracts and migration file OK; no transactions or database writes were performed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
