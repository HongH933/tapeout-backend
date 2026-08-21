# TapeMarket Seaport orderbook backend

Independent Node.js 22 / Fastify / PostgreSQL service for TapeOut Market V5. It stores public Seaport 1.6 signed listings and indexes confirmed fills; it never accepts or stores private keys and never sends user transactions.

## Local start

1. Copy `.env.example` to `.env`, set `FEE_RECIPIENT`, and keep the canonical BSC addresses unchanged.
2. Run `docker compose up -d postgres`, `npm install`, `npm run db:migrate`.
3. Start `npm run dev` and `npm run dev:worker` in separate terminals. Open `/docs` for OpenAPI UI.

If `FEE_RECIPIENT` is absent/zero, read endpoints start but listing quote/submission return `WRITE_API_DISABLED`. Chain startup checks require RPC chain ID 56 plus bytecode at the canonical Seaport, Validator, and ConduitController addresses.

## API v1

- `GET /health`, `GET /ready`, `GET /api/v1/config`
- `POST /api/v1/listings/quote`, `POST /api/v1/listings`
- `GET /api/v1/accounts/:offerer/markets/:transistors/:tokenId/listing-capacity`
- `GET /api/v1/listings/:orderHash`, `POST /api/v1/listings/:orderHash/revalidate`
- `POST /api/v1/listings/revalidate-batch`
- `GET /api/v1/markets/:transistors/:tokenId/listings|fills|summary`
- `POST /api/v1/markets/summaries` for up to 50 deduplicated market summaries
- `POST /api/v1/markets/:transistors/:tokenId/batch-quote` for strict manual selection or price-ordered budget Sweep
- `GET /api/v1/accounts/:offerer/listings`

Amounts and chain counters are decimal strings. Submission recomputes the hash, signature signer, exact 1% per-unit fee, recipients, Factory relationship, balance, direct Seaport approval, counter, and order status. `isValidated=false` is recorded as a valid off-chain signature state, not treated as rejection.

Seaport does not lock ERC-1155 assets. Listing capacity is a TapeMarket-only soft reservation: current wallet `balanceOf` minus unexpired remaining quantity in `PENDING_VALIDATION`, `ACTIVE`, `PARTIALLY_FILLED`, `STALE`, `INVALID_BALANCE`, and `INVALID_APPROVAL`. Other marketplaces and unpublished signatures are outside this calculation. Quote checks capacity when `offerer` is supplied; publication always rechecks it. Publication uses a PostgreSQL advisory transaction lock keyed by seller/Transistors/token ID, recomputes the SQL aggregate inside the transaction, and preserves duplicate-order idempotency.

Errors return structured `code`, `message`, `details`, and `requestId`. Logs include request ID, offerer, order hash, error code, and validator codes where relevant, while signature and complete parameters stay redacted.

Batch quotes are short-lived, deterministic plans for one allowlisted market. Manual selection fails the full plan on any changed order; Sweep skips invalid candidates, includes the 1% buyer fee inside its budget, and may partially fill the final order. The API performs controlled-concurrency batch validation and never signs, builds, or sends the transaction. See [`docs/batch-quote.md`](docs/batch-quote.md).

## Database and worker

`migrations/0001_initial.sql` creates processors, assets, listings, fills, and resumable checkpoints. The worker scans `CPUCreated` and confirmed Seaport fulfillment/cancellation logs in bounded ranges, writes idempotently, and revalidates active/recoverable listings every configured interval. Run migrations before API/worker rollouts and back up PostgreSQL with scheduled encrypted RDS snapshots or `pg_dump`; rehearse restores.

Batch summaries read only existing listings, fills, and checkpoints. 24h and indexed volume sum `seller_proceeds_wei`; `buyer_total_wei` is intentionally excluded so the 1% taker fee never inflates trade volume. This capacity/summary release adds no table, column, destructive migration, or rewrite of existing order hashes/signatures.

## Docker and AWS

`compose.yaml` provides private PostgreSQL, one migration job, API, and worker from one image. For EC2, terminate TLS at an ALB, expose only API port 8080 through its security group, put containers/RDS in private subnets, use Secrets Manager/SSM for environment values, ship JSON logs and health metrics to CloudWatch, and alarm on readiness/RPC lag/error rates. For production, replace Compose PostgreSQL with PostgreSQL 16 RDS, apply migrations as a one-shot deployment task, and restrict RDS ingress to the service security group.

Set `CORS_ORIGINS` to exact Vercel production/preview origins; production wildcard CORS is not accepted. No `.env` is copied into the image. There is no private-key, admin signer, server fill, or mutable fee HTTP endpoint.

## Validation

Run `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, and `docker compose config`. Fork tests require an explicit `BSC_FORK_RPC_URL` and Anvil; they contain no private key and must never broadcast to BSC mainnet.

## Current limits

V1 supports EOA signatures. Smart-account offerers are rejected with `SMART_ACCOUNT_NOT_SUPPORTED`. `SEAPORT_INDEX_START_BLOCK` must be chosen before fill history can be indexed. The public fills/summary HTTP response remains empty until the worker checkpoint has synchronized confirmed logs. Synchronous submission calls Canonical Validator `isValidOrderWithConfiguration`, rejects returned errors, and persists its numeric errors/warnings.
