import { loadConfig } from "./config.js";
import { createChainClient, assertCanonicalDeployments } from "./chain/client.js";
import { createPool } from "./db/client.js";
import { PostgresListingRepository } from "./db/postgres-repository.js";
import { buildApp } from "./app.js";

const config = loadConfig(); const chainClient = createChainClient(config);
if (config.chainStartupCheck) await assertCanonicalDeployments(chainClient, config);
const app = await buildApp({ config, chainClient, repository: new PostgresListingRepository(createPool(config.databaseUrl)) });
const close = async () => { await app.close(); process.exit(0); }; process.on("SIGINT", close); process.on("SIGTERM", close);
await app.listen({ port: config.port, host: "0.0.0.0" });
