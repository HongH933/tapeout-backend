import "dotenv/config";
import { getAddress, isAddress } from "ethers";
import { z } from "zod";

export const CANONICAL = {
  chainId: 56,
  factory: "0x68224F668083c29e9800Be2a646d42d18cedF7e2",
  legacyMarketplace: "0xA6a80C1919a8326022d7c601a488888C13aA16E4",
  seaport: "0x0000000000000068F116a894984e2DB1123eB395",
  validator: "0x00e5F120f500006757E984F1DED400fc00370000",
  conduitController: "0x00000000F9490004C11Cef243f5400493c00Ad63",
} as const;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"), PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1), BSC_RPC_HTTP_URL: z.string().url(), BSC_RPC_FALLBACK_URLS: z.string().default(""),
  CHAIN_ID: z.coerce.number().int().default(56), FACTORY_ADDRESS: z.string().default(CANONICAL.factory),
  LEGACY_MARKETPLACE_ADDRESS: z.string().default(CANONICAL.legacyMarketplace), SEAPORT_ADDRESS: z.string().default(CANONICAL.seaport),
  SEAPORT_VALIDATOR_ADDRESS: z.string().default(CANONICAL.validator), CONDUIT_CONTROLLER_ADDRESS: z.string().default(CANONICAL.conduitController),
  FEE_RECIPIENT: z.string().default(""), MAKER_FEE_BPS: z.coerce.number().int().default(0), TAKER_FEE_BPS: z.coerce.number().int().default(100),
  FACTORY_START_BLOCK: z.coerce.bigint().default(115900000n), SEAPORT_INDEX_START_BLOCK: z.string().default(""),
  CHAIN_CONFIRMATIONS: z.coerce.number().int().nonnegative().default(15), LISTING_REVALIDATION_SECONDS: z.coerce.number().int().positive().default(60),
  LISTING_STALE_SECONDS: z.coerce.number().int().positive().default(120), CORS_ORIGINS: z.string().default("http://localhost:3000"), LOG_LEVEL: z.string().default("info"),
  CHAIN_STARTUP_CHECK: z.string().default("true").transform((v) => v === "true"),
});

export type AppConfig = ReturnType<typeof loadConfig>;
export function loadConfig(input: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(input);
  const exact = (actual: string | number, expected: string | number, name: string) => {
    if (String(actual).toLowerCase() !== String(expected).toLowerCase()) throw new Error(`${name} must equal canonical value ${expected}`);
  };
  exact(env.CHAIN_ID, CANONICAL.chainId, "CHAIN_ID"); exact(env.FACTORY_ADDRESS, CANONICAL.factory, "FACTORY_ADDRESS");
  exact(env.LEGACY_MARKETPLACE_ADDRESS, CANONICAL.legacyMarketplace, "LEGACY_MARKETPLACE_ADDRESS"); exact(env.SEAPORT_ADDRESS, CANONICAL.seaport, "SEAPORT_ADDRESS");
  exact(env.SEAPORT_VALIDATOR_ADDRESS, CANONICAL.validator, "SEAPORT_VALIDATOR_ADDRESS"); exact(env.CONDUIT_CONTROLLER_ADDRESS, CANONICAL.conduitController, "CONDUIT_CONTROLLER_ADDRESS");
  if (env.MAKER_FEE_BPS !== 0 || env.TAKER_FEE_BPS !== 100) throw new Error("Fees must be Maker 0 BPS / Taker 100 BPS");
  const writeEnabled = isAddress(env.FEE_RECIPIENT) && getAddress(env.FEE_RECIPIENT) !== "0x0000000000000000000000000000000000000000";
  return {
    nodeEnv: env.NODE_ENV, port: env.PORT, databaseUrl: env.DATABASE_URL, rpcUrls: [env.BSC_RPC_HTTP_URL, ...env.BSC_RPC_FALLBACK_URLS.split(",").map((v) => v.trim()).filter(Boolean)],
    chainId: env.CHAIN_ID, factoryAddress: getAddress(env.FACTORY_ADDRESS), legacyMarketplaceAddress: getAddress(env.LEGACY_MARKETPLACE_ADDRESS),
    seaportAddress: getAddress(env.SEAPORT_ADDRESS), validatorAddress: getAddress(env.SEAPORT_VALIDATOR_ADDRESS), conduitControllerAddress: getAddress(env.CONDUIT_CONTROLLER_ADDRESS),
    feeRecipient: writeEnabled ? getAddress(env.FEE_RECIPIENT) : null, makerFeeBps: env.MAKER_FEE_BPS, takerFeeBps: env.TAKER_FEE_BPS,
    factoryStartBlock: env.FACTORY_START_BLOCK, seaportIndexStartBlock: env.SEAPORT_INDEX_START_BLOCK ? BigInt(env.SEAPORT_INDEX_START_BLOCK) : null,
    confirmations: env.CHAIN_CONFIRMATIONS, revalidationSeconds: env.LISTING_REVALIDATION_SECONDS, staleSeconds: env.LISTING_STALE_SECONDS,
    corsOrigins: env.CORS_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean), logLevel: env.LOG_LEVEL, chainStartupCheck: env.CHAIN_STARTUP_CHECK,
    writeEnabled, maxListingDurationSeconds: 30 * 24 * 60 * 60,
  };
}
