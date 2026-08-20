# Batch quote API

The API plans manual multi-order purchases and budget Sweep purchases for one allowlisted TapeOut market. It never signs or broadcasts a transaction. The browser converts an accepted plan into one Canonical Seaport `fulfillAvailableAdvancedOrders` transaction through the official Seaport SDK.

## Endpoints

- `GET /api/v1/markets/:transistors/:tokenId/listings?limit=...&cursor=...` returns stable price/hash pagination.
- `POST /api/v1/markets/:transistors/:tokenId/batch-quote` accepts `SELECTED` or `SWEEP`.
- `POST /api/v1/listings/revalidate-batch` rechecks the exact quoted orders.

`SELECTED` contains a buyer plus explicit `{ orderHash, quantity }` items. Any missing, duplicate, own, changed, invalid, expired, cancelled, filled, underfunded, or unapproved order fails the whole request.

`SWEEP` contains buyer, native-BNB budget, optional maximum seller unit price, and maximum order count. Candidates are sorted by seller unit price and order hash. Invalid candidates are skipped with warnings, and the final eligible order may be partially filled by a whole ERC-1155 quantity. Buyer-paid 1% fees are included inside the budget.

## Quote invariants

- All arithmetic uses decimal-string bigint wei; no floating-point price math is used.
- A quote is market-, buyer-, chain-, fee-, and mode-specific.
- `planHash` is deterministic over the material request and planned items.
- `expiresAt` defaults to 15 seconds after creation; the quote does not reserve inventory.
- Public batches are capped at 20 orders and Sweep scans at most 500 candidates.
- Aggregate seller balances are checked per seller/contract/token, not just per order.
- Price impact and weighted averages use integer basis-point/wei math.

The client must request a new quote and revalidate immediately before simulation and before confirmation. A changed `planHash` requires another user review.

## Configuration

```text
BATCH_QUOTE_TTL_SECONDS=15
BATCH_MAX_ORDERS=20
BATCH_MAX_CANDIDATES=500
BATCH_REVALIDATION_CONCURRENCY=4
```

Batch quote generation fails closed if batch support, fee configuration, the public market allowlist, or chain validation is unavailable. It does not disable read APIs or the legacy official buy-offer path.

## Tests

`npm test` covers selected planning, Sweep ordering/partial final fills, fees, caps, expiry/plan changes, aggregate seller inventory, API validation, worker idempotency, and multiple `OrderFulfilled` logs in one transaction. `npm run test:fork` is conditional on an explicit `BSC_FORK_RPC_URL`; it uses Anvil only and never broadcasts to BSC mainnet. The fork benchmark records 1/3/5/10/20 order calldata, estimate/static-call timings, and rejects gas above 70% of the fork block gas limit.
