import { loadConfig } from "./config.js";
import { createChainClient, assertCanonicalDeployments } from "./chain/client.js";
import { createPool } from "./db/client.js";
import { PostgresListingRepository } from "./db/postgres-repository.js";
import { revalidateBatch } from "./jobs/listing-revalidator.js";
import { syncFactory } from "./jobs/factory-sync.js";
import { syncSeaportEvents } from "./jobs/seaport-event-sync.js";

const config = loadConfig(); const client = createChainClient(config); if (config.chainStartupCheck) await assertCanonicalDeployments(client, config);
const pool = createPool(config.databaseUrl); const repository = new PostgresListingRepository(pool); let stopped = false;
process.on("SIGINT", () => { stopped = true; }); process.on("SIGTERM", () => { stopped = true; });
while (!stopped) {
  try { await syncFactory(pool, client, config); await syncSeaportEvents(pool, client, config); await revalidateBatch(repository, client, config); }
  catch (error) { console.error("worker cycle failed", error instanceof Error ? error.message : error); }
  await new Promise((resolve) => setTimeout(resolve, config.revalidationSeconds * 1_000));
}
await repository.close();
