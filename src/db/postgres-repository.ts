import type pg from "pg";
import type { ListingRecord } from "../domain/listing.js";
import { decodeMarketCursor, encodeMarketCursor, type ListingQuery, type ListingRepository, type ListingValidationPatch, type MarketPageQuery, type SweepCandidateQuery } from "./repository.js";

function map(row: any): ListingRecord {
  return {
    orderHash: row.order_hash, chainId: row.chain_id, seaportAddress: row.seaport_address, offerer: row.offerer,
    processorAddress: row.processor_address, transistorsAddress: row.transistors_address, tokenId: String(row.token_id), assetType: row.asset_type,
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
  async insert(l: ListingRecord) {
    const values = [l.orderHash.toLowerCase(), l.chainId, l.seaportAddress.toLowerCase(), l.offerer.toLowerCase(), l.processorAddress.toLowerCase(), l.transistorsAddress.toLowerCase(), l.tokenId, l.assetType, l.initialQuantity, l.remainingQuantity, l.sellerUnitPriceWei, l.takerFeePerUnitWei, l.buyerUnitTotalWei, l.sellerTotalWei, l.feeTotalWei, l.buyerTotalWei, l.startTime, l.endTime, l.parameters.orderType, l.parameters.zone, l.parameters.zoneHash, l.parameters.conduitKey, l.parameters.counter, l.parameters.salt, JSON.stringify(l.parameters), l.signature, l.status, l.validationState, JSON.stringify(l.validationDetails), JSON.stringify(l.validatorCodes), l.lastValidatedAt];
    const sql = `INSERT INTO seaport_listings (order_hash,chain_id,seaport_address,offerer,processor_address,transistors_address,token_id,asset_type,initial_quantity,remaining_quantity,seller_unit_price_wei,taker_fee_per_unit_wei,buyer_unit_total_wei,seller_total_wei,fee_total_wei,buyer_total_wei,start_time,end_time,order_type,zone,zone_hash,conduit_key,counter,salt,parameters_json,signature,status,validation_state,validation_details_json,validator_codes_json,last_validated_at) VALUES (${values.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT (order_hash) DO NOTHING RETURNING *`;
    const result = await this.pool.query(sql, values); return result.rows[0] ? map(result.rows[0]) : (await this.get(l.orderHash))!;
  }
  async list(q: ListingQuery) {
    const clauses: string[] = []; const values: unknown[] = [];
    const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace("?", `$${values.length}`)); };
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
    return result.rows.map((row) => ({ orderHash: row.order_hash, txHash: row.tx_hash, logIndex: row.log_index, blockNumber: String(row.block_number), blockTimestamp: new Date(row.block_timestamp).toISOString(), seller: row.seller, buyer: row.buyer, transistorsAddress: row.transistors_address, tokenId: String(row.token_id), quantity: String(row.quantity), sellerUnitPriceWei: String(row.seller_unit_price_wei), sellerProceedsWei: String(row.seller_proceeds_wei), takerFeeWei: String(row.taker_fee_wei), buyerTotalWei: String(row.buyer_total_wei), source: "SEAPORT_LISTING_SALE" as const }));
  }
  async summary(transistorsAddress: string, tokenId: string) {
    const [listing, fills] = await Promise.all([
      this.pool.query("SELECT min(seller_unit_price_wei) best_ask,min(buyer_unit_total_wei) best_total,count(*) active_count,coalesce(sum(remaining_quantity),0) active_quantity FROM seaport_listings WHERE transistors_address=$1 AND token_id=$2 AND status IN ('ACTIVE','PARTIALLY_FILLED')", [transistorsAddress.toLowerCase(), tokenId]),
      this.pool.query("SELECT (array_agg(seller_unit_price_wei ORDER BY block_number DESC,log_index DESC))[1] last_sale,coalesce(sum(CASE WHEN block_timestamp>=now()-interval '24 hours' THEN seller_proceeds_wei ELSE 0 END),0) volume_24h FROM seaport_fills WHERE transistors_address=$1 AND token_id=$2", [transistorsAddress.toLowerCase(), tokenId]),
    ]); const l = listing.rows[0]; const f = fills.rows[0]; return { bestAskWei: l.best_ask ? String(l.best_ask) : null, bestAskBuyerTotalWei: l.best_total ? String(l.best_total) : null, activeListingCount: String(l.active_count), activeListingQuantity: String(l.active_quantity), lastSeaportSaleWei: f.last_sale ? String(f.last_sale) : null, seaportVolume24hWei: String(f.volume_24h), generatedAt: new Date().toISOString() };
  }
  async close() { await this.pool.end(); }
}
