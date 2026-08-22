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
import { assertListingCapacity } from "./domain/listing-capacity.js";
import { quoteOrder } from "./domain/order-math.js";
import { assertBatchQuoteExpectation, buildSelectedBatchQuote, buildSweepBatchQuote, type BatchCandidate } from "./domain/batch-quote.js";
import { circuitCollectionAllowed, inspectListings, readListingWalletBalance, resolveAndValidateAsset, revalidateListing, validateAsset, validateCircuitAsset, validateSignedListing } from "./chain/validation.js";
import { accountParamsSchema, batchQuoteSchema, circuitCapacityParamsSchema, circuitCollectionParamsSchema, circuitListQuerySchema, circuitParamsSchema, circuitSummariesSchema, hashParamsSchema, listingCapacityParamsSchema, marketParamsSchema, marketSummariesSchema, quoteSchema, revalidateBatchSchema, signedListingSchema } from "./api/schemas.js";

export type AppDependencies = { config: AppConfig; repository: ListingRepository; chainClient: PublicClient };
export async function buildApp({ config, repository, chainClient }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: config.logLevel, redact: ["req.headers.authorization", "req.body.signature", "req.body.parameters"] }, bodyLimit: 256 * 1024 });
  await app.register(helmet); await app.register(cors, { origin(origin, callback) { if (!origin || config.corsOrigins.includes(origin)) callback(null, true); else callback(new Error("Origin not allowed"), false); }, credentials: false });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(swagger, { openapi: { info: { title: "TapeMarket Seaport Orderbook API", version: "1.0.0" }, servers: [{ url: "/" }] } });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.setErrorHandler((error, request, reply) => {
    const body = request.body as { orderHash?: unknown; offerer?: unknown; parameters?: { offerer?: unknown } } | undefined;
    const offerer = typeof body?.parameters?.offerer === "string" ? body.parameters.offerer : typeof body?.offerer === "string" ? body.offerer : undefined;
    const orderHash = typeof body?.orderHash === "string" ? body.orderHash : undefined;
    if (error instanceof DomainError) {
      request.log.warn({ requestId: request.id, offerer, orderHash, errorCode: error.code, validatorCodes: error.code === "VALIDATOR_REJECTED" ? error.details : undefined }, error.message);
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details ?? null, requestId: request.id } });
    }
    if ((error as any).name === "ZodError") return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "Request validation failed", details: (error as any).issues, requestId: request.id } });
    if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429) return reply.status(429).send({ error: { code: "RATE_LIMITED", message: "Rate limit exceeded", details: null, requestId: request.id } });
    request.log.error({ err: error, requestId: request.id, offerer, orderHash, errorCode: "INTERNAL_ERROR" });
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error", details: null, requestId: request.id } });
  });
  app.get("/health", { schema: { tags: ["health"] } }, async () => ({ ok: true }));
  app.get("/ready", { schema: { tags: ["health"] } }, async (_request, reply) => { try { await repository.ready(); return { ready: true, writeEnabled: config.writeEnabled }; } catch { return reply.status(503).send({ ready: false, writeEnabled: false }); } });
  app.get("/api/v1/config", { schema: { tags: ["config"] } }, async () => ({ chainId: config.chainId, seaportAddress: config.seaportAddress, validatorAddress: config.validatorAddress, factoryAddress: config.factoryAddress, circuitCollections: config.circuitCollections, feeRecipient: config.feeRecipient, makerFeeBps: config.makerFeeBps, takerFeeBps: config.takerFeeBps, maxListingDurationSeconds: config.maxListingDurationSeconds, batchQuoteTtlSeconds: config.batchQuoteTtlSeconds, maxBatchOrders: config.maxBatchOrders, batchEnabled: config.batchEnabled, writeEnabled: config.writeEnabled }));
  app.post("/api/v1/listings/quote", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["listings"] } }, async (request) => {
    if (!config.writeEnabled) throw new DomainError("WRITE_API_DISABLED", "FEE_RECIPIENT is not configured", 503);
    const body = quoteSchema.parse(request.body); const now = BigInt(Math.floor(Date.now() / 1000)); const end = BigInt(body.endTime);
    if (end <= now || end - now > BigInt(config.maxListingDurationSeconds)) throw new DomainError("ORDER_EXPIRED", "End time must be within the next 30 days");
    if (body.assetStandard === "ERC721") {
      const owner = await validateCircuitAsset(chainClient, config, body.collectionAddress, body.tokenId);
      if (owner.toLowerCase() !== body.offerer.toLowerCase()) throw new DomainError("CIRCUIT_NOT_OWNER", "This wallet is no longer the owner", 409);
      const capacity = await repository.getCircuitListingCapacity({ offerer: body.offerer, collectionAddress: body.collectionAddress, tokenId: body.tokenId, currentOwner: owner, nowSeconds: now.toString() });
      if (capacity.availableToList !== "1") throw new DomainError("CIRCUIT_ALREADY_LISTED", "This Circuit already has an open listing", 409);
      return { assetStandard: "ERC721", processorAddress: body.processorAddress, collectionAddress: body.collectionAddress, transistorsAddress: null, tokenId: body.tokenId, endTime: body.endTime, ...quoteOrder(body.sellerUnitPriceWei, "1", BigInt(config.takerFeeBps)), feeRecipient: config.feeRecipient, makerFeeBps: String(config.makerFeeBps), takerFeeBps: String(config.takerFeeBps) };
    }
    await validateAsset(chainClient, config, body.processorAddress, body.transistorsAddress, body.tokenId);
    if (body.offerer) {
      const walletBalance = await readListingWalletBalance(chainClient, body.offerer, body.transistorsAddress, body.tokenId);
      const capacity = await repository.getListingCapacity({ offerer: body.offerer, transistorsAddress: body.transistorsAddress, tokenId: body.tokenId, walletBalance, nowSeconds: now.toString() });
      assertListingCapacity(capacity, body.quantity, body.tokenId === "0" ? "NAND" : "LATCH");
    }
    return { assetStandard: "ERC1155", processorAddress: body.processorAddress, collectionAddress: body.collectionAddress ?? body.transistorsAddress, transistorsAddress: body.transistorsAddress, tokenId: body.tokenId, endTime: body.endTime, ...quoteOrder(body.sellerUnitPriceWei, body.quantity, BigInt(config.takerFeeBps)), feeRecipient: config.feeRecipient, makerFeeBps: String(config.makerFeeBps), takerFeeBps: String(config.takerFeeBps) };
  });
  app.post("/api/v1/listings", { config: { rateLimit: { max: 10, timeWindow: "1 minute", keyGenerator(request) { const offerer = (request.body as { parameters?: { offerer?: unknown } } | undefined)?.parameters?.offerer; return typeof offerer === "string" ? offerer.toLowerCase() : request.ip; } } }, schema: { tags: ["listings"] } }, async (request, reply) => {
    const body = signedListingSchema.parse(request.body); const hash = body.orderHash?.toLowerCase(); if (hash) { const existing = await repository.get(hash); if (existing) return existing; }
    const listing = await validateSignedListing(chainClient, config, { assetStandard: body.assetStandard, processorAddress: body.processorAddress, ...(body.collectionAddress ? { collectionAddress: body.collectionAddress } : {}), parameters: body.parameters, signature: body.signature, ...(body.orderHash ? { orderHash: body.orderHash } : {}) }); const existing = await repository.get(listing.orderHash); if (existing) return existing;
    const walletBalance = listing.assetStandard === "ERC721" ? "1" : await readListingWalletBalance(chainClient, listing.offerer, listing.transistorsAddress!, listing.tokenId);
    const readCurrentOwner = listing.assetStandard === "ERC721" ? () => validateCircuitAsset(chainClient, config, listing.collectionAddress, listing.tokenId) : undefined;
    return reply.status(201).send(await repository.insertWithCapacityCheck({ listing, walletBalance, nowSeconds: String(Math.floor(Date.now() / 1_000)), ...(readCurrentOwner ? { readCurrentOwner } : {}) }));
  });
  app.get("/api/v1/listings/:orderHash", { schema: { tags: ["listings"] } }, async (request) => { const { orderHash } = hashParamsSchema.parse(request.params); const result = await repository.get(orderHash); if (!result) throw new DomainError("NOT_FOUND", "Listing not found", 404); return result; });
  app.post("/api/v1/listings/:orderHash/revalidate", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["listings"] } }, async (request) => {
    const { orderHash } = hashParamsSchema.parse(request.params); const listing = await repository.get(orderHash); if (!listing) throw new DomainError("NOT_FOUND", "Listing not found", 404);
    const patch = await revalidateListing(chainClient, config, listing); return (await repository.updateValidation(orderHash, patch))!;
  });
  app.get("/api/v1/markets/:transistorsAddress/:tokenId/listings", { schema: { tags: ["markets"] } }, async (request) => {
    const params = marketParamsSchema.parse(request.params); const query = request.query as Record<string, string | undefined>;
    const page = await repository.listMarketPage({ ...params, statuses: ["ACTIVE", "PARTIALLY_FILLED", "STALE"], limit: query.limit ? Number(query.limit) : 50, ...(query.cursor ? { cursor: query.cursor } : {}) });
    const listings = page.listings;
    const staleBefore = Date.now() - config.staleSeconds * 1_000;
    const refreshed = await Promise.all(listings.map(async (listing) => {
      if (listing.status !== "STALE" && Date.parse(listing.lastValidatedAt) >= staleBefore) return listing;
      try { const patch = await revalidateListing(chainClient, config, listing); return (await repository.updateValidation(listing.orderHash, patch)) ?? listing; }
      catch (error) {
        return (await repository.updateValidation(listing.orderHash, { status: "STALE", validationState: "RPC_ERROR", validationDetails: { message: error instanceof Error ? error.message : "Unknown RPC error" }, lastValidatedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })) ?? listing;
      }
    }));
    return { listings: refreshed.filter((listing) => ["ACTIVE", "PARTIALLY_FILLED", "STALE"].includes(listing.status)), nextCursor: page.nextCursor };
  });
  app.post("/api/v1/markets/:transistorsAddress/:tokenId/batch-quote", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["markets", "batch"] } }, async (request) => {
    if (!config.batchEnabled) throw new DomainError("WRITE_API_DISABLED", "Batch quotes are disabled", 503);
    const params = marketParamsSchema.parse(request.params); const body = batchQuoteSchema.parse(request.body);
    const asOfBlock = (await chainClient.getBlockNumber()).toString();
    if (body.mode === "SELECTED") {
      const uniqueHashes = [...new Set(body.items.map((item) => item.orderHash.toLowerCase()))];
      if (uniqueHashes.length !== body.items.length) throw new DomainError("BATCH_PLAN_CHANGED", "Selected listings contain duplicates", 409);
      if (body.items.length > config.maxBatchOrders) throw new DomainError("BATCH_TOO_MANY_ORDERS", `A batch supports at most ${config.maxBatchOrders} listings`);
      const listings = await repository.getMany(uniqueHashes); const byHash = new Map(listings.map((listing) => [listing.orderHash.toLowerCase(), listing]));
      const preflightIssues = body.items.flatMap((item) => {
        const listing = byHash.get(item.orderHash.toLowerCase());
        if (!listing) return [{ orderHash: item.orderHash, issueCode: "LISTING_NOT_FOUND" }];
        if (listing.assetStandard !== "ERC1155" || listing.transistorsAddress?.toLowerCase() !== params.transistorsAddress.toLowerCase() || listing.tokenId !== params.tokenId) return [{ orderHash: item.orderHash, issueCode: "LISTING_NOT_FOUND" }];
        if (listing.offerer.toLowerCase() === body.buyer.toLowerCase()) return [{ orderHash: item.orderHash, issueCode: "SELF_LISTING" }];
        return [];
      });
      if (preflightIssues.length) throw new DomainError("BATCH_PLAN_CHANGED", "One or more selected listings changed", 409, { issues: preflightIssues });
      const ordered = body.items.map((item) => byHash.get(item.orderHash.toLowerCase())!);
      await validateAsset(chainClient, config, ordered[0]!.processorAddress, params.transistorsAddress, params.tokenId);
      const inspections = await inspectListings(chainClient, config, ordered);
      await repository.revalidateMany(inspections.map((inspection) => ({ orderHash: inspection.listing.orderHash, patch: inspection.patch })));
      const issues = inspections.flatMap((inspection) => inspection.issueCode ? [{ orderHash: inspection.listing.orderHash, issueCode: inspection.issueCode }] : []);
      if (issues.length) throw new DomainError("BATCH_PLAN_CHANGED", "One or more selected listings are no longer fillable", 409, { issues });
      const candidates: BatchCandidate[] = inspections.map((inspection) => ({ listing: { ...inspection.listing, ...inspection.patch }, sellerBalance: inspection.balance }));
      const quote = buildSelectedBatchQuote({ chainId: config.chainId, buyer: body.buyer, transistorsAddress: params.transistorsAddress, tokenId: params.tokenId, asOfBlock, ttlSeconds: config.batchQuoteTtlSeconds, maxOrders: config.maxBatchOrders }, candidates, body.items);
      return assertBatchQuoteExpectation(quote, body.expectedPlanHash, body.quoteExpiresAt);
    }
    const maxOrders = body.maxOrders ?? config.maxBatchOrders;
    if (maxOrders > config.maxBatchOrders) throw new DomainError("BATCH_TOO_MANY_ORDERS", `A batch supports at most ${config.maxBatchOrders} listings`);
    const listings = await repository.listSweepCandidates({ ...params, excludeOfferer: body.buyer, maxSellerUnitPriceWei: body.maxSellerUnitPriceWei, statuses: ["ACTIVE", "PARTIALLY_FILLED"], limit: config.maxBatchCandidates });
    if (!listings.length) {
      const first = await repository.listMarketPage({ ...params, statuses: ["ACTIVE", "PARTIALLY_FILLED"], limit: 1 }); const best = first.listings[0];
      if (best && BigInt(best.sellerUnitPriceWei) > BigInt(body.maxSellerUnitPriceWei)) throw new DomainError("MAX_PRICE_BELOW_BEST_ASK", "Maximum seller unit price is below the best ask", 409, { bestAskSellerUnitPriceWei: best.sellerUnitPriceWei });
      throw new DomainError("BATCH_EMPTY", "No fillable listings matched this sweep", 409);
    }
    await validateAsset(chainClient, config, listings[0]!.processorAddress, params.transistorsAddress, params.tokenId);
    const inspections = await inspectListings(chainClient, config, listings);
    await repository.revalidateMany(inspections.map((inspection) => ({ orderHash: inspection.listing.orderHash, patch: inspection.patch })));
    const issueCounts = new Map<string, number>();
    for (const inspection of inspections) if (inspection.issueCode) issueCounts.set(inspection.issueCode, (issueCounts.get(inspection.issueCode) ?? 0) + 1);
    const warnings = [...issueCounts.entries()].map(([code, count]) => `${code}:${count}`);
    const candidates: BatchCandidate[] = inspections.filter((inspection) => !inspection.issueCode && inspection.listing.offerer.toLowerCase() !== body.buyer.toLowerCase()).map((inspection) => ({ listing: { ...inspection.listing, ...inspection.patch }, sellerBalance: inspection.balance }));
    const quote = buildSweepBatchQuote({ chainId: config.chainId, buyer: body.buyer, transistorsAddress: params.transistorsAddress, tokenId: params.tokenId, asOfBlock, ttlSeconds: config.batchQuoteTtlSeconds, maxOrders, warnings }, candidates, BigInt(body.budgetWei), BigInt(body.maxSellerUnitPriceWei));
    return assertBatchQuoteExpectation(quote, body.expectedPlanHash, body.quoteExpiresAt);
  });
  app.post("/api/v1/listings/revalidate-batch", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["listings", "batch"] } }, async (request) => {
    const body = revalidateBatchSchema.parse(request.body); const orderHashes = [...new Set(body.orderHashes.map((hash) => hash.toLowerCase()))];
    if (orderHashes.length > config.maxBatchOrders) throw new DomainError("BATCH_TOO_MANY_ORDERS", `A batch supports at most ${config.maxBatchOrders} listings`);
    const listings = await repository.getMany(orderHashes); const found = new Set(listings.map((listing) => listing.orderHash.toLowerCase()));
    const inspections = await inspectListings(chainClient, config, listings);
    await repository.revalidateMany(inspections.map((inspection) => ({ orderHash: inspection.listing.orderHash, patch: inspection.patch })));
    return { results: [...inspections.map((inspection) => ({ orderHash: inspection.listing.orderHash, status: inspection.patch.status, remainingQuantity: inspection.patch.remainingQuantity, balance: inspection.balance, approval: inspection.approval, counter: inspection.counter, orderStatus: inspection.orderStatus, validatorResult: inspection.validatorResult, lastValidatedAt: inspection.patch.lastValidatedAt, issueCode: inspection.issueCode })), ...orderHashes.filter((hash) => !found.has(hash)).map((orderHash) => ({ orderHash, status: null, remainingQuantity: null, balance: null, approval: null, counter: null, orderStatus: null, validatorResult: null, lastValidatedAt: new Date().toISOString(), issueCode: "LISTING_NOT_FOUND" }))] };
  });
  app.get("/api/v1/accounts/:address/listings", { schema: { tags: ["accounts"] } }, async (request) => { const { address } = accountParamsSchema.parse(request.params); return { listings: await repository.list({ offerer: address, limit: 100 }) }; });
  app.get("/api/v1/accounts/:address/markets/:transistorsAddress/:tokenId/listing-capacity", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["accounts", "markets"] } }, async (request) => {
    const params = listingCapacityParamsSchema.parse(request.params);
    await resolveAndValidateAsset(chainClient, config, params.transistorsAddress, params.tokenId);
    const [walletBalance, asOfBlock] = await Promise.all([
      readListingWalletBalance(chainClient, params.address, params.transistorsAddress, params.tokenId),
      chainClient.getBlockNumber().then(String),
    ]);
    const capacity = await repository.getListingCapacity({ offerer: params.address, transistorsAddress: params.transistorsAddress, tokenId: params.tokenId, walletBalance });
    return { address: params.address, transistorsAddress: params.transistorsAddress, tokenId: params.tokenId, assetType: params.tokenId === "0" ? "NAND" : "LATCH", ...capacity, asOfBlock, generatedAt: new Date().toISOString() };
  });
  app.get("/api/v1/markets/:transistorsAddress/:tokenId/fills", { schema: { tags: ["markets"] } }, async (request) => { const params = marketParamsSchema.parse(request.params); return { fills: await repository.listFills(params.transistorsAddress, params.tokenId) }; });
  app.get("/api/v1/markets/:transistorsAddress/:tokenId/summary", { schema: { tags: ["markets"] } }, async (request) => { const params = marketParamsSchema.parse(request.params); return { ...await repository.summary(params.transistorsAddress, params.tokenId), generatedAt: new Date().toISOString() }; });
  app.post("/api/v1/markets/summaries", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["markets"] } }, async (request) => {
    const body = marketSummariesSchema.parse(request.body);
    const seen = new Set<string>();
    const markets = body.markets.filter((market) => { const key = `${market.transistorsAddress.toLowerCase()}:${market.tokenId}`; if (seen.has(key)) return false; seen.add(key); return true; });
    await Promise.all(markets.map((market) => resolveAndValidateAsset(chainClient, config, market.transistorsAddress, market.tokenId)));
    return repository.summaries(markets);
  });
  const assertCircuitCollection = (collectionAddress: string) => {
    if (!circuitCollectionAllowed(config, collectionAddress)) throw new DomainError("CIRCUIT_COLLECTION_NOT_ALLOWED", "Circuit collection is not supported", 404);
  };
  app.get("/api/v1/circuit-collections/:collectionAddress/listings", { schema: { tags: ["circuits"] } }, async (request) => {
    const { collectionAddress } = circuitCollectionParamsSchema.parse(request.params); assertCircuitCollection(collectionAddress);
    const query = circuitListQuerySchema.parse(request.query);
    const page = await repository.listCircuitPage({ collectionAddress, statuses: ["ACTIVE"], limit: query.limit, ...(query.cursor ? { cursor: query.cursor } : {}), sort: query.sort });
    return page;
  });
  app.get("/api/v1/circuit-collections/:collectionAddress/fills", { schema: { tags: ["circuits"] } }, async (request) => {
    const { collectionAddress } = circuitCollectionParamsSchema.parse(request.params); assertCircuitCollection(collectionAddress);
    return { fills: await repository.listCircuitFills(collectionAddress) };
  });
  app.get("/api/v1/circuit-collections/:collectionAddress/summary", { schema: { tags: ["circuits"] } }, async (request) => {
    const { collectionAddress } = circuitCollectionParamsSchema.parse(request.params); assertCircuitCollection(collectionAddress);
    const result = await repository.circuitSummaries([collectionAddress]); return { ...result.summaries[0], generatedAt: result.generatedAt, lastIndexedBlock: result.lastIndexedBlock, indexerStale: result.indexerStale };
  });
  app.post("/api/v1/circuit-collections/summaries", { schema: { tags: ["circuits"] } }, async (request) => {
    const body = circuitSummariesSchema.parse(request.body); const collections = [...new Set(body.collections.map((value) => value.toLowerCase()))];
    collections.forEach(assertCircuitCollection); return repository.circuitSummaries(collections);
  });
  app.get("/api/v1/circuits/:collectionAddress/:tokenId/listings", { schema: { tags: ["circuits"] } }, async (request) => {
    const params = circuitParamsSchema.parse(request.params); assertCircuitCollection(params.collectionAddress);
    return repository.listCircuitPage({ collectionAddress: params.collectionAddress, tokenId: params.tokenId, statuses: ["ACTIVE", "STALE"], limit: 20, sort: "price_asc" });
  });
  app.get("/api/v1/circuits/:collectionAddress/:tokenId/fills", { schema: { tags: ["circuits"] } }, async (request) => {
    const params = circuitParamsSchema.parse(request.params); assertCircuitCollection(params.collectionAddress);
    return { fills: await repository.listCircuitFills(params.collectionAddress, params.tokenId) };
  });
  app.get("/api/v1/accounts/:address/circuit-listings", { schema: { tags: ["accounts", "circuits"] } }, async (request) => {
    const { address } = accountParamsSchema.parse(request.params); return { listings: await repository.list({ offerer: address, assetStandard: "ERC721", limit: 100 }) };
  });
  app.get("/api/v1/accounts/:address/circuits/:collectionAddress/:tokenId/listing-capacity", { schema: { tags: ["accounts", "circuits"] } }, async (request) => {
    const params = circuitCapacityParamsSchema.parse(request.params); const owner = await validateCircuitAsset(chainClient, config, params.collectionAddress, params.tokenId);
    const [capacity, asOfBlock] = await Promise.all([
      repository.getCircuitListingCapacity({ offerer: params.address, collectionAddress: params.collectionAddress, tokenId: params.tokenId, currentOwner: owner }),
      chainClient.getBlockNumber().then(String),
    ]);
    return { address: params.address, assetStandard: "ERC721", collectionAddress: params.collectionAddress, transistorsAddress: null, tokenId: params.tokenId, assetType: "CIRCUIT", ...capacity, asOfBlock, generatedAt: new Date().toISOString() };
  });
  app.addHook("onClose", async () => repository.close());
  return app;
}
