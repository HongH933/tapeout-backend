import type pg from "pg";
import type { ListingRecord } from "../domain/listing.js";
import { CIRCUIT_RESERVING_LISTING_STATUSES, RESERVING_LISTING_STATUSES, isCircuitListing } from "../domain/listing.js";
import { DomainError } from "../domain/errors.js";
import { assertListingCapacity, calculateListingCapacity } from "../domain/listing-capacity.js";
import { decodeMarketCursor, encodeMarketCursor, type InsertWithCapacityCheckInput, type ListingCapacityKey, type ListingQuery, type ListingRepository, type ListingValidationPatch, type MarketIdentity, type MarketPageQuery, type SweepCandidateQuery } from "./repository.js";

function map(row: any): ListingRecord {
  return {
    orderHash: row.order_hash, chainId: row.chain_id, seaportAddress: row.seaport_address, offerer: row.offerer,
    processorAddress: row.processor_address, assetStandard: row.asset_standard ?? "ERC1155", collectionAddress: row.collection_address ?? row.transistors_address, transistorsAddress: row.transistors_address, tokenId: String(row.token_id), assetType: row.asset_type,
    initialQuantity: String(row.initial_quantity), remainingQuantity: String(row.remaining_quantity), sellerUnitPriceWei: String(row.seller_unit_price_wei),
    takerFeePerUnitWei: String(row.taker_fee_per_unit_wei), buyerUnitTotalWei: String(row.buyer_unit_total_wei), sellerTotalWei: String(row.seller_total_wei),
    feeTotalWei: String(row.fee_total_wei), buyerTotalWei: String(row.buyer_total_wei), parameters: row.parameters_json, signature: row.signature,
    status: row.status, validationState: row.validation_state, validationDetails: row.validation_details_json, validatorCodes: row.validator_codes_json,
    startTime: String(row.start_time), endTime: String(row.end_time), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), lastValidatedAt: new Date(row.last_validated_at).toISOString(),
  };
}

export class PostgresListingRepository implements ListingRepository {
  constructor(private readonly pool: pg.Pool) {}
  async ready() { await this.pool.query("SELECT 1"); return true; }
  async get(orderHash: string) { const result = await this.pool.query("SELECT * FROM seaport_listings WHERE order_hash=$1", [orderHash.toLowerCase()]); return result.rows[0] ? map(result.rows[0]) : null; }
  async getMany(orderHashes: string[]) {
    if (!orderHashes.length) return [];
    const result = await this.pool.query("SELECT * FROM seaport_listings WHERE order_hash=ANY($1::text[])", [orderHashes.map((hash) => hash.toLowerCase())]);
    return result.rows.map(map);
  }
  private async insertUsing(executor: Pick<pg.Pool, "query"> | pg.PoolClient, l: ListingRecord) {
    const values = [l.orderHash.toLowerCase(), l.chainId, l.seaportAddress.toLowerCase(), l.offerer.toLowerCase(), l.processorAddress.toLowerCase(), l.assetStandard, l.collectionAddress.toLowerCase(), l.transistorsAddress?.toLowerCase() ?? null, l.tokenId, l.assetType, l.initialQuantity, l.remainingQuantity, l.sellerUnitPriceWei, l.takerFeePerUnitWei, l.buyerUnitTotalWei, l.sellerTotalWei, l.feeTotalWei, l.buyerTotalWei, l.startTime, l.endTime, l.parameters.orderType, l.parameters.zone, l.parameters.zoneHash, l.parameters.conduitKey, l.parameters.counter, l.parameters.salt, JSON.stringify(l.parameters), l.signature, l.status, l.validationState, JSON.stringify(l.validationDetails), JSON.stringify(l.validatorCodes), l.lastValidatedAt];
    const sql = `INSERT INTO seaport_listings (order_hash,chain_id,seaport_address,offerer,processor_address,asset_standard,collection_address,transistors_address,token_id,asset_type,initial_quantity,remaining_quantity,seller_unit_price_wei,taker_fee_per_unit_wei,buyer_unit_total_wei,seller_total_wei,fee_total_wei,buyer_total_wei,start_time,end_time,order_type,zone,zone_hash,conduit_key,counter,salt,parameters_json,signature,status,validation_state,validation_details_json,validator_codes_json,last_validated_at) VALUES (${values.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT (order_hash) DO NOTHING RETURNING *`;
    const result = await executor.query(sql, values);
    if (result.rows[0]) return map(result.rows[0]);
    const existing = await executor.query("SELECT * FROM seaport_listings WHERE order_hash=$1", [l.orderHash.toLowerCase()]);
    return map(existing.rows[0]);
  }
  async insert(l: ListingRecord) { return this.insertUsing(this.pool, l); }
  private async capacityAggregate(executor: Pick<pg.Pool, "query"> | pg.PoolClient, input: ListingCapacityKey) {
    const nowSeconds = input.nowSeconds ?? String(Math.floor(Date.now() / 1_000));
    const result = await executor.query(
      "SELECT coalesce(sum(remaining_quantity),0) reserved_quantity,count(*) reserving_count FROM seaport_listings WHERE offerer=$1 AND transistors_address=$2 AND token_id=$3 AND end_time>$4 AND status=ANY($5::text[])",
      [input.offerer.toLowerCase(), input.transistorsAddress.toLowerCase(), input.tokenId, nowSeconds, [...RESERVING_LISTING_STATUSES]],
    );
    return { reservedListingQuantity: String(result.rows[0]?.reserved_quantity ?? "0"), reservingListingCount: Number(result.rows[0]?.reserving_count ?? 0) };
  }
  async getReservedListingQuantity(input: ListingCapacityKey) { return (await this.capacityAggregate(this.pool, input)).reservedListingQuantity; }
  async getListingCapacity(input: ListingCapacityKey & { walletBalance: string }) {
    const aggregate = await this.capacityAggregate(this.pool, input);
    return calculateListingCapacity(input.walletBalance, aggregate.reservedListingQuantity, aggregate.reservingListingCount);
  }
  async getCircuitListingCapacity(input: { offerer: string; collectionAddress: string; tokenId: string; currentOwner: string; nowSeconds?: string }) {
    const nowSeconds = input.nowSeconds ?? String(Math.floor(Date.now() / 1_000));
    const result = await this.pool.query("SELECT count(*) reserving_count FROM seaport_listings WHERE asset_standard='ERC721' AND offerer=$1 AND collection_address=$2 AND token_id=$3 AND end_time>$4 AND status=ANY($5::text[])", [input.offerer.toLowerCase(), input.collectionAddress.toLowerCase(), input.tokenId, nowSeconds, [...CIRCUIT_RESERVING_LISTING_STATUSES]]);
    const count = Number(result.rows[0]?.reserving_count ?? 0); const owner = input.currentOwner.toLowerCase() === input.offerer.toLowerCase();
    return calculateListingCapacity(owner ? "1" : "0", count > 0 ? "1" : "0", count);
  }
  async insertWithCapacityCheck({ listing, walletBalance, nowSeconds, readCurrentOwner }: InsertWithCapacityCheckInput) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lockIdentity = `${listing.chainId}:${listing.assetStandard}:${listing.offerer.toLowerCase()}:${listing.collectionAddress.toLowerCase()}:${listing.tokenId}`;
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [lockIdentity]);
      const existing = await client.query("SELECT * FROM seaport_listings WHERE order_hash=$1", [listing.orderHash.toLowerCase()]);
      if (existing.rows[0]) { await client.query("COMMIT"); return map(existing.rows[0]); }
      if (isCircuitListing(listing)) {
        const currentOwner = readCurrentOwner ? await readCurrentOwner() : walletBalance === "1" ? listing.offerer : "";
        if (currentOwner.toLowerCase() !== listing.offerer.toLowerCase()) throw new DomainError("CIRCUIT_NOT_OWNER", "This wallet is no longer the owner", 409);
        const result = await client.query("SELECT count(*) reserving_count FROM seaport_listings WHERE asset_standard='ERC721' AND offerer=$1 AND collection_address=$2 AND token_id=$3 AND end_time>$4 AND status=ANY($5::text[])", [listing.offerer.toLowerCase(), listing.collectionAddress.toLowerCase(), listing.tokenId, nowSeconds ?? String(Math.floor(Date.now() / 1_000)), [...CIRCUIT_RESERVING_LISTING_STATUSES]]);
        if (Number(result.rows[0]?.reserving_count ?? 0) > 0) throw new DomainError("CIRCUIT_ALREADY_LISTED", "This Circuit already has an open listing", 409);
      } else {
        const aggregate = await this.capacityAggregate(client, { offerer: listing.offerer, transistorsAddress: listing.transistorsAddress!, tokenId: listing.tokenId, ...(nowSeconds ? { nowSeconds } : {}) });
        const capacity = calculateListingCapacity(walletBalance, aggregate.reservedListingQuantity, aggregate.reservingListingCount);
        assertListingCapacity(capacity, listing.initialQuantity, listing.assetType === "LATCH" ? "LATCH" : "NAND");
      }
      const inserted = await this.insertUsing(client, listing);
      await client.query("COMMIT");
      return inserted;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
  async list(q: ListingQuery) {
    const clauses: string[] = []; const values: unknown[] = [];
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
    if (q.assetStandard) add("asset_standard=?", q.assetStandard); if (q.collectionAddress) add("collection_address=?", q.collectionAddress.toLowerCase());
    if (q.transistorsAddress) add("transistors_address=?", q.transistorsAddress.toLowerCase()); if (q.tokenId) add("token_id=?", q.tokenId);
    if (q.offerer) add("offerer=?", q.offerer.toLowerCase()); if (q.statuses?.length) add("status=ANY(?::text[])", q.statuses);
    if (q.cursor) add("order_hash>?", q.cursor.toLowerCase()); const limit = Math.min(q.limit ?? 50, 100); values.push(limit);
    const result = await this.pool.query(`SELECT * FROM seaport_listings ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY seller_unit_price_wei ASC, order_hash ASC LIMIT $${values.length}`, values);
    return result.rows.map(map);
  }
  async listMarketPage(q: MarketPageQuery) {
    const values: unknown[] = [q.transistorsAddress.toLowerCase(), q.tokenId, q.statuses ?? ["ACTIVE", "PARTIALLY_FILLED"]];
    const clauses = ["transistors_address=$1", "token_id=$2", "status=ANY($3::text[])"];
    if (q.cursor) {
      const cursor = decodeMarketCursor(q.cursor); values.push(cursor.sellerUnitPriceWei, cursor.orderHash);
      clauses.push(`(seller_unit_price_wei>$4 OR (seller_unit_price_wei=$4 AND order_hash>$5))`);
    }
    const limit = Math.min(Math.max(q.limit, 1), 100); values.push(limit + 1);
    const result = await this.pool.query(`SELECT * FROM seaport_listings WHERE ${clauses.join(" AND ")} ORDER BY seller_unit_price_wei ASC,order_hash ASC LIMIT $${values.length}`, values);
    const rows = result.rows.map(map); const hasMore = rows.length > limit; const listings = rows.slice(0, limit); const last = listings.at(-1);
    return { listings, nextCursor: hasMore && last ? encodeMarketCursor({ sellerUnitPriceWei: last.sellerUnitPriceWei, orderHash: last.orderHash }) : null };
  }
  async listSweepCandidates(q: SweepCandidateQuery) {
    const limit = Math.min(Math.max(q.limit, 1), 2_000);
    const result = await this.pool.query("SELECT * FROM seaport_listings WHERE transistors_address=$1 AND token_id=$2 AND offerer<>$3 AND status=ANY($4::text[]) AND seller_unit_price_wei<=$5 AND end_time>extract(epoch from now()) ORDER BY seller_unit_price_wei ASC,order_hash ASC LIMIT $6", [q.transistorsAddress.toLowerCase(), q.tokenId, q.excludeOfferer.toLowerCase(), q.statuses, q.maxSellerUnitPriceWei, limit]);
    return result.rows.map(map);
  }
  async updateValidation(orderHash: string, patch: ListingValidationPatch) {
    const keys: Record<string, string> = { status: "status", remainingQuantity: "remaining_quantity", validationState: "validation_state", validationDetails: "validation_details_json", validatorCodes: "validator_codes_json", lastValidatedAt: "last_validated_at", updatedAt: "updated_at" };
    const entries = Object.entries(patch).filter(([k]) => keys[k]); if (!entries.length) return this.get(orderHash);
    const values = entries.map(([, value]) => typeof value === "object" ? JSON.stringify(value) : value); values.push(orderHash.toLowerCase());
    const result = await this.pool.query(`UPDATE seaport_listings SET ${entries.map(([key], i) => `${keys[key]}=$${i + 1}`).join(",")} WHERE order_hash=$${values.length} RETURNING *`, values);
    return result.rows[0] ? map(result.rows[0]) : null;
  }
  async revalidateMany(updates: Array<{ orderHash: string; patch: ListingValidationPatch }>) {
    return (await Promise.all(updates.map(({ orderHash, patch }) => this.updateValidation(orderHash, patch)))).filter((row): row is ListingRecord => row !== null);
  }
  async listFills(transistorsAddress: string, tokenId: string, limit = 100) {
    const result = await this.pool.query("SELECT * FROM seaport_fills WHERE transistors_address=$1 AND token_id=$2 ORDER BY block_number DESC,log_index DESC LIMIT $3", [transistorsAddress.toLowerCase(), tokenId, Math.min(limit, 200)]);
    return result.rows.map((row) => ({ orderHash: row.order_hash, txHash: row.tx_hash, logIndex: row.log_index, blockNumber: String(row.block_number), blockTimestamp: new Date(row.block_timestamp).toISOString(), seller: row.seller, buyer: row.buyer, assetStandard: row.asset_standard ?? "ERC1155", collectionAddress: row.collection_address ?? row.transistors_address, transistorsAddress: row.transistors_address, tokenId: String(row.token_id), quantity: String(row.quantity), sellerUnitPriceWei: String(row.seller_unit_price_wei), sellerProceedsWei: String(row.seller_proceeds_wei), takerFeeWei: String(row.taker_fee_wei), buyerTotalWei: String(row.buyer_total_wei), source: "SEAPORT_LISTING_SALE" as const }));
  }
  async listCircuitPage(input: { collectionAddress: string; tokenId?: string; statuses?: ListingRecord["status"][]; limit: number; cursor?: string; sort?: "price_asc" | "newest" }) {
    const clauses = ["asset_standard='ERC721'", "collection_address=$1", "status=ANY($2::text[])", "end_time>extract(epoch from now())"];
    const values: unknown[] = [input.collectionAddress.toLowerCase(), input.statuses ?? ["ACTIVE"]];
    if (input.tokenId !== undefined) { values.push(input.tokenId); clauses.push(`token_id=$${values.length}`); }
    if (input.cursor) {
      let cursor: { sort: "price_asc" | "newest"; value: string; orderHash: string };
      try { cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")); } catch { throw new Error("INVALID_CURSOR"); }
      if (cursor.sort !== (input.sort ?? "price_asc") || !cursor.value || !/^0x[0-9a-fA-F]{64}$/.test(cursor.orderHash)) throw new Error("INVALID_CURSOR");
      values.push(cursor.value, cursor.orderHash.toLowerCase()); const valueIndex = values.length - 1; const hashIndex = values.length;
      clauses.push(input.sort === "newest" ? `(created_at<$${valueIndex} OR (created_at=$${valueIndex} AND order_hash>$${hashIndex}))` : `(seller_unit_price_wei>$${valueIndex} OR (seller_unit_price_wei=$${valueIndex} AND order_hash>$${hashIndex}))`);
    }
    const limit = Math.min(Math.max(input.limit, 1), 100); values.push(limit + 1);
    const order = input.sort === "newest" ? "created_at DESC,order_hash ASC" : "seller_unit_price_wei ASC,order_hash ASC";
    const result = await this.pool.query(`SELECT * FROM seaport_listings WHERE ${clauses.join(" AND ")} ORDER BY ${order} LIMIT $${values.length}`, values);
    const rows = result.rows.map(map); const hasMore = rows.length > limit; const listings = rows.slice(0, limit); const last = listings.at(-1);
    return { listings, nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ sort: input.sort ?? "price_asc", value: input.sort === "newest" ? last.createdAt : last.sellerUnitPriceWei, orderHash: last.orderHash }), "utf8").toString("base64url") : null };
  }
  async listCircuitFills(collectionAddress: string, tokenId?: string, limit = 100) {
    const values: unknown[] = [collectionAddress.toLowerCase()]; const tokenClause = tokenId === undefined ? "" : ` AND token_id=$2`;
    if (tokenId !== undefined) values.push(tokenId); values.push(Math.min(limit, 200));
    const result = await this.pool.query(`SELECT * FROM seaport_fills WHERE asset_standard='ERC721' AND collection_address=$1${tokenClause} ORDER BY block_number DESC,log_index DESC LIMIT $${values.length}`, values);
    return result.rows.map((row) => ({ orderHash: row.order_hash, txHash: row.tx_hash, logIndex: row.log_index, blockNumber: String(row.block_number), blockTimestamp: new Date(row.block_timestamp).toISOString(), seller: row.seller, buyer: row.buyer, assetStandard: "ERC721" as const, collectionAddress: row.collection_address, transistorsAddress: null, tokenId: String(row.token_id), quantity: "1", sellerUnitPriceWei: String(row.seller_unit_price_wei), sellerProceedsWei: String(row.seller_proceeds_wei), takerFeeWei: String(row.taker_fee_wei), buyerTotalWei: String(row.buyer_total_wei), source: "SEAPORT_LISTING_SALE" as const }));
  }
  async circuitSummaries(collections: string[]) {
    if (!collections.length) return { summaries: [], generatedAt: new Date().toISOString(), lastIndexedBlock: null, indexerStale: true };
    const result = await this.pool.query(`WITH requested AS (SELECT lower(unnest($1::text[])) collection_address), checkpoint AS (SELECT block_number,updated_at FROM sync_checkpoints WHERE stream='seaport')
      SELECT requested.collection_address,
        listings.best_ask,listings.best_total,coalesce(listings.active_count,0) active_count,
        fills.last_sale,fills.last_sale_at,fills.last_sale_tx,coalesce(fills.volume_24h,0) volume_24h,coalesce(fills.volume_all_time,0) volume_all_time,coalesce(fills.fill_count_24h,0) fill_count_24h,coalesce(fills.fill_count_all_time,0) fill_count_all_time,
        checkpoint.block_number checkpoint_block,checkpoint.updated_at checkpoint_updated_at
      FROM requested
      LEFT JOIN LATERAL (
        SELECT (array_agg(seller_unit_price_wei ORDER BY seller_unit_price_wei,order_hash))[1] best_ask,
          (array_agg(buyer_unit_total_wei ORDER BY seller_unit_price_wei,order_hash))[1] best_total,count(*) active_count
        FROM seaport_listings WHERE asset_standard='ERC721' AND collection_address=requested.collection_address AND status='ACTIVE' AND end_time>extract(epoch from now())
      ) listings ON true
      LEFT JOIN LATERAL (
        SELECT (array_agg(seller_unit_price_wei ORDER BY block_number DESC,log_index DESC))[1] last_sale,
          (array_agg(block_timestamp ORDER BY block_number DESC,log_index DESC))[1] last_sale_at,
          (array_agg(tx_hash ORDER BY block_number DESC,log_index DESC))[1] last_sale_tx,
          coalesce(sum(seller_proceeds_wei) FILTER (WHERE block_timestamp>=now()-interval '24 hours'),0) volume_24h,
          coalesce(sum(seller_proceeds_wei),0) volume_all_time,
          count(*) FILTER (WHERE block_timestamp>=now()-interval '24 hours') fill_count_24h,
          count(*) fill_count_all_time
        FROM seaport_fills WHERE asset_standard='ERC721' AND collection_address=requested.collection_address
      ) fills ON true LEFT JOIN checkpoint ON true`, [collections.map((value) => value.toLowerCase())]);
    const checkpoint = result.rows[0];
    return { summaries: result.rows.map((row) => ({ collectionAddress: row.collection_address, bestAskWei: row.best_ask ? String(row.best_ask) : null, bestAskBuyerTotalWei: row.best_total ? String(row.best_total) : null, activeListingCount: String(row.active_count), lastSaleWei: row.last_sale ? String(row.last_sale) : null, lastSaleAt: row.last_sale_at ? new Date(row.last_sale_at).toISOString() : null, lastSaleTxHash: row.last_sale_tx ?? null, volume24hWei: String(row.volume_24h), volumeAllTimeWei: String(row.volume_all_time), fillCount24h: String(row.fill_count_24h), indexedSaleCount: String(row.fill_count_all_time) })), generatedAt: new Date().toISOString(), lastIndexedBlock: checkpoint?.checkpoint_block ? String(checkpoint.checkpoint_block) : null, indexerStale: !checkpoint?.checkpoint_updated_at || Date.now() - Date.parse(checkpoint.checkpoint_updated_at) > 5 * 60_000 };
  }
  async summaries(markets: MarketIdentity[]) {
    if (!markets.length) return { summaries: [], generatedAt: new Date().toISOString(), lastIndexedBlock: null, indexerStale: true };
    const result = await this.pool.query(`WITH requested AS (
      SELECT lower(transistors_address) transistors_address,token_id::numeric token_id
      FROM unnest($1::text[],$2::text[]) AS requested(transistors_address,token_id)
    ), checkpoint AS (
      SELECT block_number,updated_at FROM sync_checkpoints WHERE stream='seaport'
    )
    SELECT requested.transistors_address,requested.token_id,
      listings.best_ask,listings.best_total,coalesce(listings.active_count,0) active_count,coalesce(listings.active_quantity,0) active_quantity,
      fills.last_sale,fills.last_sale_at,fills.last_sale_tx,coalesce(fills.volume_24h,0) volume_24h,coalesce(fills.volume_all_time,0) volume_all_time,coalesce(fills.fill_count_24h,0) fill_count_24h,
      checkpoint.block_number checkpoint_block,checkpoint.updated_at checkpoint_updated_at
    FROM requested
    LEFT JOIN LATERAL (
      SELECT (array_agg(seller_unit_price_wei ORDER BY seller_unit_price_wei ASC,order_hash ASC))[1] best_ask,
        (array_agg(buyer_unit_total_wei ORDER BY seller_unit_price_wei ASC,order_hash ASC))[1] best_total,
        count(*) active_count,coalesce(sum(remaining_quantity),0) active_quantity
      FROM seaport_listings WHERE transistors_address=requested.transistors_address AND token_id=requested.token_id
        AND status IN ('ACTIVE','PARTIALLY_FILLED') AND end_time>extract(epoch from now())
    ) listings ON true
    LEFT JOIN LATERAL (
      SELECT (array_agg(seller_unit_price_wei ORDER BY block_number DESC,log_index DESC))[1] last_sale,
        (array_agg(block_timestamp ORDER BY block_number DESC,log_index DESC))[1] last_sale_at,
        (array_agg(tx_hash ORDER BY block_number DESC,log_index DESC))[1] last_sale_tx,
        coalesce(sum(seller_proceeds_wei) FILTER (WHERE block_timestamp>=now()-interval '24 hours'),0) volume_24h,
        coalesce(sum(seller_proceeds_wei),0) volume_all_time,
        count(*) FILTER (WHERE block_timestamp>=now()-interval '24 hours') fill_count_24h
      FROM seaport_fills WHERE transistors_address=requested.transistors_address AND token_id=requested.token_id
    ) fills ON true
    LEFT JOIN checkpoint ON true`, [markets.map((market) => market.transistorsAddress.toLowerCase()), markets.map((market) => market.tokenId)]);
    const generatedAt = new Date().toISOString();
    const summaries = result.rows.map((row) => ({
      transistorsAddress: row.transistors_address, tokenId: String(row.token_id), bestAskWei: row.best_ask ? String(row.best_ask) : null,
      bestAskBuyerTotalWei: row.best_total ? String(row.best_total) : null, activeListingCount: String(row.active_count), activeListingQuantity: String(row.active_quantity),
      lastSeaportSaleWei: row.last_sale ? String(row.last_sale) : null, lastSeaportSaleAt: row.last_sale_at ? new Date(row.last_sale_at).toISOString() : null,
      lastSeaportSaleTxHash: row.last_sale_tx ?? null, seaportVolume24hWei: String(row.volume_24h), seaportVolumeAllTimeWei: String(row.volume_all_time), seaportFillCount24h: String(row.fill_count_24h),
    }));
    const checkpoint = result.rows[0];
    return { summaries, generatedAt, lastIndexedBlock: checkpoint?.checkpoint_block ? String(checkpoint.checkpoint_block) : null, indexerStale: !checkpoint?.checkpoint_updated_at || Date.now() - Date.parse(checkpoint.checkpoint_updated_at) > 5 * 60_000 };
  }
  async summary(transistorsAddress: string, tokenId: string) { return (await this.summaries([{ transistorsAddress, tokenId }])).summaries[0]!; }
  async close() { await this.pool.end(); }
}
