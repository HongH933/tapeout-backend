import { readFile } from "node:fs/promises";
import { createPublicClient, encodeFunctionData, encodePacked, getAddress, http, keccak256, parseAbi } from "viem";
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
const erc20Abi = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const v3PoolAbi = parseAbi(["function factory() view returns (address)", "function token0() view returns (address)", "function token1() view returns (address)", "function fee() view returns (uint24)", "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint32,bool)", "function liquidity() view returns (uint128)"]);
const v3FactoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const seaportReadAbi = parseAbi(["function getCounter(address offerer) view returns (uint256)"]);
const PANCAKE_V3_FACTORY = getAddress("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865");

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
  const [bemCode, usdtCode, poolCode, bemName, bemSymbol, bemDecimals, usdtSymbol, usdtDecimals, poolFactory, token0, token1, fee, slot0, liquidity] = await Promise.all([
    client.getBytecode({ address: config.bemTokenAddress }), client.getBytecode({ address: config.usdtTokenAddress }), client.getBytecode({ address: config.bemUsdtPoolAddress }),
    client.readContract({ address: config.bemTokenAddress as `0x${string}`, abi: erc20Abi, functionName: "name" }), client.readContract({ address: config.bemTokenAddress as `0x${string}`, abi: erc20Abi, functionName: "symbol" }), client.readContract({ address: config.bemTokenAddress as `0x${string}`, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: config.usdtTokenAddress as `0x${string}`, abi: erc20Abi, functionName: "symbol" }), client.readContract({ address: config.usdtTokenAddress as `0x${string}`, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: config.bemUsdtPoolAddress as `0x${string}`, abi: v3PoolAbi, functionName: "factory" }), client.readContract({ address: config.bemUsdtPoolAddress as `0x${string}`, abi: v3PoolAbi, functionName: "token0" }), client.readContract({ address: config.bemUsdtPoolAddress as `0x${string}`, abi: v3PoolAbi, functionName: "token1" }), client.readContract({ address: config.bemUsdtPoolAddress as `0x${string}`, abi: v3PoolAbi, functionName: "fee" }), client.readContract({ address: config.bemUsdtPoolAddress as `0x${string}`, abi: v3PoolAbi, functionName: "slot0" }), client.readContract({ address: config.bemUsdtPoolAddress as `0x${string}`, abi: v3PoolAbi, functionName: "liquidity" }),
  ]);
  if (!bemCode || bemCode === "0x" || !usdtCode || usdtCode === "0x" || !poolCode || poolCode === "0x") throw new Error("BEM_MARKET_BYTECODE_MISSING");
  const tokens = new Set([token0.toLowerCase(), token1.toLowerCase()]);
  if (!tokens.has(config.bemTokenAddress.toLowerCase()) || !tokens.has(config.usdtTokenAddress.toLowerCase()) || tokens.size !== 2) throw new Error("BEM_POOL_TOKEN_MISMATCH");
  if (poolFactory.toLowerCase() !== PANCAKE_V3_FACTORY.toLowerCase() || slot0[0] <= 0n || liquidity <= 0n) throw new Error("BEM_POOL_INVALID");
  const factoryPool = await client.readContract({ address: PANCAKE_V3_FACTORY, abi: v3FactoryAbi, functionName: "getPool", args: [config.bemTokenAddress as `0x${string}`, config.usdtTokenAddress as `0x${string}`, fee] });
  if (factoryPool.toLowerCase() !== config.bemUsdtPoolAddress.toLowerCase()) throw new Error("BEM_POOL_FACTORY_MISMATCH");
  await client.readContract({ address: config.seaportAddress as `0x${string}`, abi: seaportReadAbi, functionName: "getCounter", args: ["0x0000000000000000000000000000000000000000"] });
  const migration = await readFile(new URL("../migrations/0002_circuit_listings.sql", import.meta.url), "utf8");
  for (const field of ["asset_standard", "collection_address", "ERC721", "CIRCUIT"]) if (!migration.includes(field)) throw new Error(`MIGRATION_FIELD_MISSING:${field}`);
  const bemMigration = await readFile(new URL("../migrations/0004_bem_erc20_orderbook.sql", import.meta.url), "utf8");
  for (const field of ["ERC20", "BEM_USDT", "base_amount_remaining", "seller_quote_amount", "seaport_listings_bem_active_price_idx"]) if (!bemMigration.includes(field)) throw new Error(`BEM_MIGRATION_FIELD_MISSING:${field}`);
  console.log(`Fee recipient: ${config.feeRecipient ?? "NOT CONFIGURED (writes fail closed)"}`);
  console.log(`BEM market: ${bemName} (${bemSymbol}, ${bemDecimals}) / ${usdtSymbol} (${usdtDecimals}), pool fee ${fee}, factory ${poolFactory}, factory.getPool ${factoryPool}`);
  console.log(`BEM orderbook enabled: ${config.bemOrderbookEnabled}; Seaport ERC-20 AdvancedOrder path is code-present and covered by order-shape tests.`);
  console.log("Chain contracts and migrations 0002/0004 OK; no transactions or database writes were performed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
