# BEM/USDT ERC20 Orderbook V1

## Migration and model

`migrations/0004_bem_erc20_orderbook.sql` is additive. It leaves 0001-0003 and legacy ERC1155/ERC721 rows intact, adds `ERC20`/`BEM`, `BEM_USDT`, `ASK`, explicit base/quote token and decimal fields, exact amount totals, fill step, and explicit BEM fill accounting. Legacy `wei` columns remain for old BNB markets; the BEM API and indexes use the new `*_quote_atomic` fields.

A valid V1 record is ERC20/BEM, pair BEM_USDT, side ASK, token ID 0, configured BEM as base and configured USDT as quote. Processor and Transistors fields are null. Price, seller proceeds, 1% fee, buyer total, initial/remaining BEM and fill step are stored independently. Price, seller and reserving listing indexes plus fill-time indexes support the API and 24-hour summary.

## Seaport shape and exact math

The offer is one fixed ERC20 BEM item. Consideration is exactly two fixed ERC20 USDT items: seller proceeds to the offerer and the 1% fee to the configured fee recipient. The order is `PARTIAL_OPEN`, zero zone, zero zone hash and zero conduit key. Signature, counter, order hash, expiration, seller BEM balance/allowance, on-chain order status and Canonical Validator results are checked before insertion and revalidation.

For base quantity `Q`, unit USDT price `P`, and base scale `B = 10^baseDecimals`, seller proceeds are `S = Q*P/B`. The product must divide exactly. Fee is `F = S*100/10000` and must also divide exactly. Buyer total is `S+F`; no rounding is permitted.

The minimum BEM fill step is `lcm(Q/gcd(Q,S), Q/gcd(Q,F))`. A fill `X` must be positive, no greater than current remaining, and divisible by that step. The AdvancedOrder fraction is reduced to `X/gcd(X,Q)` over `Q/gcd(X,Q)`. Seller, fee and buyer amounts are rechecked for exact divisibility server-side.

## Capacity and concurrency

Capacity is wallet BEM balance minus remaining BEM in reserving asks. Creation acquires a PostgreSQL advisory transaction lock keyed by chain, standard, seller, collection and token before recalculating reserved quantity and inserting. BEM stays in the seller wallet; invalid-balance/invalid-approval reservations follow the existing conservative ERC1155 policy.

## API and worker

- `POST /api/v1/bem/orderbook/quote`
- `GET /api/v1/bem/orderbook/listings`
- `GET /api/v1/bem/orderbook/fills`
- `GET /api/v1/bem/orderbook/summary`
- `POST /api/v1/bem/orderbook/fill-quote`
- `GET /api/v1/accounts/:address/bem-listings`
- `GET /api/v1/accounts/:address/bem-listing-capacity`

Publication still uses `POST /api/v1/listings`; lookup and revalidation still use the shared listing routes. The worker determines semantics from order hash plus the stored listing. For BEM it requires the OrderFulfilled offer to be configured BEM and consideration recipients to be seller and fee recipient in configured USDT. It stores actual base fill, seller USDT, fee USDT and buyer total. Summary volume and last price use seller proceeds only, excluding the 1% fee.

## Deployment order and rollback boundary

Do not deploy the frontend before database/backend compatibility. Back up production PostgreSQL, run 0004 in staging, regress legacy ERC1155/ERC721, deploy the compatible API and worker, verify `/ready`, `/api/v1/config` and `npm run verify:chain`, then deploy the frontend and enable the BEM tab. Monitor API errors, database locks and worker lag.

Rollback may disable `BEM_ORDERBOOK_ENABLED` and roll back API/frontend/worker binaries. Do not drop 0004 columns during an operational rollback: old code ignores them, while dropping them would destroy BEM records. This repository does not run production migration or deployment automatically.
