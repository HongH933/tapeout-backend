import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import type { AppConfig } from "../config.js";
import { circuitAbi } from "./contracts.js";

function createClient(rpcUrls: string[]): PublicClient {
  const transports = rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 2 }));
  return createPublicClient({ chain: bsc, transport: fallback(transports, { retryCount: 2 }) }) as PublicClient;
}

export function createChainClient(config: AppConfig): PublicClient { return createClient(config.rpcUrls); }
export function createLogChainClient(config: AppConfig): PublicClient { return createClient(config.logRpcUrl ? [config.logRpcUrl] : config.rpcUrls); }
export async function assertCanonicalDeployments(client: PublicClient, config: AppConfig) {
  const chainId = await client.getChainId(); if (chainId !== config.chainId) throw new Error(`RPC chain ID ${chainId} does not match ${config.chainId}`);
  for (const [name, address] of [["Seaport", config.seaportAddress], ["Validator", config.validatorAddress], ["ConduitController", config.conduitControllerAddress]] as const) {
    const code = await client.getCode({ address: address as `0x${string}` }); if (!code || code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
  }
  for (const collection of config.circuitCollections) {
    const [code, erc721, name, symbol] = await Promise.all([
      client.getCode({ address: collection as `0x${string}` }),
      client.readContract({ address: collection as `0x${string}`, abi: circuitAbi, functionName: "supportsInterface", args: ["0x80ac58cd"] }).catch(() => false),
      client.readContract({ address: collection as `0x${string}`, abi: circuitAbi, functionName: "name" }).catch(() => ""),
      client.readContract({ address: collection as `0x${string}`, abi: circuitAbi, functionName: "symbol" }).catch(() => ""),
    ]);
    if (!code || code === "0x" || !erc721 || !name || !symbol) throw new Error(`Circuit collection validation failed at ${collection}`);
  }
}
