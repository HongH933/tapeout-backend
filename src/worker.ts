import { loadConfig } from "./config.js";
import { createChainClient, createLogChainClient, assertCanonicalDeployments } from "./chain/client.js";
import { createPool } from "./db/client.js";
import { PostgresListingRepository } from "./db/postgres-repository.js";
import { revalidateBatch } from "./jobs/listing-revalidator.js";
import { syncFactory } from "./jobs/factory-sync.js";
import { syncSeaportEvents } from "./jobs/seaport-event-sync.js";
import { runWorkerJobs } from "./jobs/worker-jobs.js";

const config = loadConfig(); const client = createChainClient(config); const logClient = createLogChainClient(config); if (config.chainStartupCheck) await assertCanonicalDeployments(client, config);
const pool = createPool(config.databaseUrl); const repository = new PostgresListingRepository(pool); let stopped = false;
process.on("SIGINT", () => { stopped = true; }); process.on("SIGTERM", () => { stopped = true; });
while (!stopped) {
  await runWorkerJobs([
    { name: "factory sync", run: () => syncFactory(pool, logClient, config) },
    { name: "seaport sync", run: () => syncSeaportEvents(pool, logClient, config) },
    { name: "listing revalidation", run: () => revalidateBatch(repository, client, config) },
  ]);
  await new Promise((resolve) => setTimeout(resolve, config.revalidationSeconds * 1_000));
}
await repository.close();
