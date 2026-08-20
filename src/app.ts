import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { PublicClient } from "viem";
import type { AppConfig } from "./config.js";
import type { ListingRepository } from "./db/repository.js";
import { DomainError } from "./domain/errors.js";
import { quoteOrder } from "./domain/order-math.js";
import { revalidateListing, validateAsset, validateSignedListing } from "./chain/validation.js";
import { accountParamsSchema, hashParamsSchema, marketParamsSchema, quoteSchema, signedListingSchema } from "./api/schemas.js";

export type AppDependencies = { config: AppConfig; repository: ListingRepository; chainClient: PublicClient };
export async function buildApp({ config, repository, chainClient }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel, redact: ["req.headers.authorization", "req.body.signature", "req.body.parameters"] }, bodyLimit: 256 * 1024 });
  await app.register(helmet); await app.register(cors, { origin(origin, callback) { if (!origin || config.corsOrigins.includes(origin)) callback(null, true); else callback(new Error("Origin not allowed"), false); }, credentials: false });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(swagger, { openapi: { info: { title: "TapeMarket Seaport Orderbook API", version: "1.0.0" }, servers: [{ url: "/" }] } });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details ?? null } });
    if ((error as any).name === "ZodError") return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "Request validation failed", details: (error as any).issues } });
    app.log.error(error); return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });
  app.get("/health", { schema: { tags: ["health"] } }, async () => ({ ok: true }));
  app.get("/ready", { schema: { tags: ["health"] } }, async (_request, reply) => { try { await repository.ready(); return { ready: true, writeEnabled: config.writeEnabled }; } catch { return reply.status(503).send({ ready: false, writeEnabled: false }); } });
  app.get("/api/v1/config", { schema: { tags: ["config"] } }, async () => ({ chainId: config.chainId, seaportAddress: config.seaportAddress, validatorAddress: config.validatorAddress, factoryAddress: config.factoryAddress, feeRecipient: config.feeRecipient, makerFeeBps: config.makerFeeBps, takerFeeBps: config.takerFeeBps, maxListingDurationSeconds: config.maxListingDurationSeconds, writeEnabled: config.writeEnabled }));
  app.post("/api/v1/listings/quote", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["listings"] } }, async (request) => {
    if (!config.writeEnabled) throw new DomainError("WRITE_API_DISABLED", "FEE_RECIPIENT is not configured", 503);
    const body = quoteSchema.parse(request.body); const now = BigInt(Math.floor(Date.now() / 1000)); const end = BigInt(body.endTime);
    if (end <= now || end - now > BigInt(config.maxListingDurationSeconds)) throw new DomainError("ORDER_EXPIRED", "End time must be within the next 30 days");
    await validateAsset(chainClient, config, body.processorAddress, body.transistorsAddress, body.tokenId);
    return { ...body, ...quoteOrder(body.sellerUnitPriceWei, body.quantity, BigInt(config.takerFeeBps)), feeRecipient: config.feeRecipient, makerFeeBps: String(config.makerFeeBps), takerFeeBps: String(config.takerFeeBps) };
  });
  app.post("/api/v1/listings", { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator(request) { const offerer = (request.body as { parameters?: { offerer?: unknown } } | undefined)?.parameters?.offerer; return typeof offerer === "string" ? offerer.toLowerCase() : request.ip; } } }, schema: { tags: ["listings"] } }, async (request, reply) => {
    const body = signedListingSchema.parse(request.body); const hash = body.orderHash?.toLowerCase(); if (hash) { const existing = await repository.get(hash); if (existing) return existing; }
    const listing = await validateSignedListing(chainClient, config, { processorAddress: body.processorAddress, parameters: body.parameters, signature: body.signature, ...(body.orderHash ? { orderHash: body.orderHash } : {}) }); const existing = await repository.get(listing.orderHash); if (existing) return existing;
    return reply.status(201).send(await repository.insert(listing));
  });
  app.get("/api/v1/listings/:orderHash", { schema: { tags: ["listings"] } }, async (request) => { const { orderHash } = hashParamsSchema.parse(request.params); const result = await repository.get(orderHash); if (!result) throw new DomainError("NOT_FOUND", "Listing not found", 404); return result; });
  app.post("/api/v1/listings/:orderHash/revalidate", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["listings"] } }, async (request) => {
    const { orderHash } = hashParamsSchema.parse(request.params); const listing = await repository.get(orderHash); if (!listing) throw new DomainError("NOT_FOUND", "Listing not found", 404);
    const patch = await revalidateListing(chainClient, config, listing); return (await repository.updateValidation(orderHash, patch))!;
  });
  app.get("/api/v1/markets/:transistorsAddress/:tokenId/listings", { schema: { tags: ["markets"] } }, async (request) => {
    const params = marketParamsSchema.parse(request.params); const query = request.query as Record<string, string | undefined>;
    const listings = await repository.list({ ...params, statuses: ["ACTIVE", "PARTIALLY_FILLED", "STALE"], limit: query.limit ? Number(query.limit) : 50, ...(query.cursor ? { cursor: query.cursor } : {}) });
    const staleBefore = Date.now() - config.staleSeconds * 1_000;
    const refreshed = await Promise.all(listings.map(async (listing) => {
      if (listing.status !== "STALE" && Date.parse(listing.lastValidatedAt) >= staleBefore) return listing;
      try { const patch = await revalidateListing(chainClient, config, listing); return (await repository.updateValidation(listing.orderHash, patch)) ?? listing; }
      catch (error) {
        return (await repository.updateValidation(listing.orderHash, { status: "STALE", validationState: "RPC_ERROR", validationDetails: { message: error instanceof Error ? error.message : "Unknown RPC error" }, lastValidatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })) ?? listing;
      }
    }));
    return { listings: refreshed.filter((listing) => ["ACTIVE", "PARTIALLY_FILLED", "STALE"].includes(listing.status)), nextCursor: null };
  });
  app.get("/api/v1/accounts/:address/listings", { schema: { tags: ["accounts"] } }, async (request) => { const { address } = accountParamsSchema.parse(request.params); return { listings: await repository.list({ offerer: address, limit: 100 }) }; });
  app.get("/api/v1/markets/:transistorsAddress/:tokenId/fills", { schema: { tags: ["markets"] } }, async (request) => { const params = marketParamsSchema.parse(request.params); return { fills: await repository.listFills(params.transistorsAddress, params.tokenId) }; });
  app.get("/api/v1/markets/:transistorsAddress/:tokenId/summary", { schema: { tags: ["markets"] } }, async (request) => { const params = marketParamsSchema.parse(request.params); return repository.summary(params.transistorsAddress, params.tokenId); });
  app.addHook("onClose", async () => repository.close());
  return app;
}
