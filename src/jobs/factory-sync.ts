import type pg from "pg";
import type { PublicClient } from "viem";
import type { AppConfig } from "../config.js";
import { factoryAbi } from "../chain/contracts.js";
import { blockRanges } from "./block-ranges.js";

export async function syncFactory(pool: pg.Pool, client: PublicClient, config: AppConfig) {
  const checkpoint = await pool.query("SELECT block_number FROM sync_checkpoints WHERE stream='factory'");
  const from = checkpoint.rows[0] ? BigInt(checkpoint.rows[0].block_number) + 1n : config.factoryStartBlock;
  const latest = await client.getBlockNumber() - BigInt(config.confirmations); if (from > latest) return 0;
  let count = 0;
  for (const { start, end } of blockRanges(from, latest, config.logScanBlockRange)) {
    const logs = await client.getContractEvents({ address: config.factoryAddress as `0x${string}`, abi: factoryAbi, eventName: "CPUCreated", fromBlock: start, toBlock: end });
    for (const log of logs) {
      const a = log.args; if (!a.circuits || !a.transistors || !a.creator) continue;
      await pool.query(`INSERT INTO processors(processor_address,transistors_address,creator,name,created_block,created_tx,verified) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT(processor_address) DO UPDATE SET transistors_address=excluded.transistors_address,verified=true,updated_at=now()`, [a.circuits.toLowerCase(), a.transistors.toLowerCase(), a.creator.toLowerCase(), a.name ?? "", log.blockNumber.toString(), log.transactionHash]);
      for (const [tokenId, asset] of [["0", "NAND"], ["1", "LATCH"]]) await pool.query(`INSERT INTO assets(chain_id,processor_address,transistors_address,token_id,asset_type,verified) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT(chain_id,transistors_address,token_id) DO UPDATE SET verified=true,updated_at=now()`, [config.chainId, a.circuits.toLowerCase(), a.transistors.toLowerCase(), tokenId, asset]);
      count++;
    }
    const block = await client.getBlock({ blockNumber: end }); await pool.query(`INSERT INTO sync_checkpoints(stream,block_number,block_hash) VALUES('factory',$1,$2) ON CONFLICT(stream) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash,updated_at=now()`, [end.toString(), block.hash]);
  }
  return count;
}
