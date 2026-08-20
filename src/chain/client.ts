import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import type { AppConfig } from "../config.js";

export function createChainClient(config: AppConfig): PublicClient {
  const transports = config.rpcUrls.map((url) => http(url, { timeout: 10_000, retryCount: 2 }));
  return createPublicClient({ chain: bsc, transport: fallback(transports, { retryCount: 2 }) }) as PublicClient;
}
export async function assertCanonicalDeployments(client: PublicClient, config: AppConfig) {
  const chainId = await client.getChainId(); if (chainId !== config.chainId) throw new Error(`RPC chain ID ${chainId} does not match ${config.chainId}`);
  for (const [name, address] of [["Seaport", config.seaportAddress], ["Validator", config.validatorAddress], ["ConduitController", config.conduitControllerAddress]] as const) {
    const code = await client.getCode({ address: address as `0x${string}` }); if (!code || code === "0x") throw new Error(`${name} has no bytecode at ${address}`);
  }
}
