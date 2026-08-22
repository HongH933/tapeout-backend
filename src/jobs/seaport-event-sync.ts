import type pg from "pg";
import type { PublicClient } from "viem";
import type { AppConfig } from "../config.js";
import { seaportAbi, seaportOrderValidatedAbi } from "../chain/contracts.js";

export async function syncSeaportEvents(pool: pg.Pool, client: PublicClient, config: AppConfig) {
  if (config.seaportIndexStartBlock === null) return 0;
  const checkpoint = await pool.query("SELECT block_number FROM sync_checkpoints WHERE stream='seaport'"); const from = checkpoint.rows[0] ? BigInt(checkpoint.rows[0].block_number) + 1n : config.seaportIndexStartBlock;
  const latest = await client.getBlockNumber() - BigInt(config.confirmations); if (from > latest) return 0; let count = 0;
  for (let start = from; start <= latest; start += 2_000n) {
    const end = start + 1_999n > latest ? latest : start + 1_999n;
    const cancelled = await client.getContractEvents({ address: config.seaportAddress as `0x${string}`, abi: seaportAbi, eventName: "OrderCancelled", fromBlock: start, toBlock: end });
    for (const log of cancelled) { if (!log.args.orderHash) continue; await pool.query("UPDATE seaport_listings SET status='CANCELLED',updated_at=now() WHERE order_hash=$1", [log.args.orderHash.toLowerCase()]); count++; }
    const fulfilled = await client.getContractEvents({ address: config.seaportAddress as `0x${string}`, abi: seaportAbi, eventName: "OrderFulfilled", fromBlock: start, toBlock: end });
    for (const log of fulfilled) {
      if (!log.args.orderHash || !log.args.offer) continue; const orderHash = log.args.orderHash.toLowerCase(); const result = await pool.query("SELECT * FROM seaport_listings WHERE order_hash=$1", [orderHash]); const listing = result.rows[0]; if (!listing) continue;
      const transfer = log.args.offer[0]; const collectionAddress = listing.collection_address ?? listing.transistors_address;
      if (!transfer || transfer.token.toLowerCase() !== collectionAddress || String(transfer.identifier) !== String(listing.token_id)) continue;
      const circuit = (listing.asset_standard ?? "ERC1155") === "ERC721";
      const quantity = BigInt(transfer.amount); if (circuit && quantity !== 1n) { await pool.query("UPDATE seaport_listings SET status='INVALID_STRUCTURE',updated_at=now() WHERE order_hash=$1 AND status<>'FILLED'", [orderHash]); continue; }
      const sellerProceeds = BigInt(listing.seller_unit_price_wei) * quantity; const fee = BigInt(listing.taker_fee_per_unit_wei) * quantity; const block = await client.getBlock({ blockNumber: log.blockNumber });
      const inserted = await pool.query(`INSERT INTO seaport_fills(chain_id,order_hash,tx_hash,log_index,block_number,block_hash,block_timestamp,seller,buyer,asset_standard,collection_address,transistors_address,token_id,quantity,seller_unit_price_wei,seller_proceeds_wei,taker_fee_wei,buyer_total_wei) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT(chain_id,tx_hash,log_index) DO NOTHING`, [config.chainId, orderHash, log.transactionHash, log.logIndex, log.blockNumber.toString(), log.blockHash, block.timestamp.toString(), listing.offerer, log.args.recipient, listing.asset_standard ?? "ERC1155", collectionAddress, listing.transistors_address, listing.token_id, quantity.toString(), listing.seller_unit_price_wei, sellerProceeds.toString(), fee.toString(), (sellerProceeds + fee).toString()]);
      if (inserted.rowCount === 1) {
        if (circuit) await pool.query("UPDATE seaport_listings SET remaining_quantity=0,status='FILLED',updated_at=now() WHERE order_hash=$1", [orderHash]);
        else await pool.query("UPDATE seaport_listings SET remaining_quantity=GREATEST(remaining_quantity-$2,0),status=CASE WHEN remaining_quantity-$2<=0 THEN 'FILLED' ELSE 'PARTIALLY_FILLED' END,updated_at=now() WHERE order_hash=$1", [orderHash, quantity.toString()]);
        count++;
      }
    }
    const counters = await client.getContractEvents({ address: config.seaportAddress as `0x${string}`, abi: seaportAbi, eventName: "CounterIncremented", fromBlock: start, toBlock: end });
    for (const log of counters) { if (!log.args.offerer || log.args.newCounter === undefined) continue; await pool.query("UPDATE seaport_listings SET status='INVALID_COUNTER',validation_state='COUNTER_INCREMENTED',updated_at=now() WHERE offerer=$1 AND status IN ('ACTIVE','PARTIALLY_FILLED') AND counter<>$2", [log.args.offerer.toLowerCase(), log.args.newCounter.toString()]); count++; }
    const validated = await client.getContractEvents({ address: config.seaportAddress as `0x${string}`, abi: seaportOrderValidatedAbi, eventName: "OrderValidated", fromBlock: start, toBlock: end });
    for (const log of validated) { if (!log.args.orderHash) continue; await pool.query("UPDATE seaport_listings SET validation_state='ONCHAIN_VALIDATED',updated_at=now() WHERE order_hash=$1", [log.args.orderHash.toLowerCase()]); count++; }
    const block = await client.getBlock({ blockNumber: end }); await pool.query(`INSERT INTO sync_checkpoints(stream,block_number,block_hash) VALUES('seaport',$1,$2) ON CONFLICT(stream) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,updated_at=now()`, [end.toString(), block.hash]);
  }
  return count;
}
