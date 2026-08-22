# Circuit listings

Circuit Marketplace V1 extends the existing Seaport order book with a shared asset discriminator instead of a second NFT service. `ERC1155` rows keep their original transistors address and behavior; official TapeOut and Behemoth Circuit rows use `ERC721`, `collection_address`, `asset_type=CIRCUIT`, and quantity one.

## Migration

`0002_circuit_listings.sql` adds and backfills `asset_standard` and `collection_address` on listings and fills, then permits `transistors_address` to be null only for valid Circuit rows. It preserves every existing order hash and signature, retains the original indexes, adds Circuit listing/activity indexes, and uses a partial unique index as the final concurrent reservation guard. Do not edit or rerun `0001_initial.sql` manually.

## Validation and capacity

Only the fixed TapeOut and Behemoth ERC-721 collections on chain 56 are accepted. Startup checks chain ID, bytecode, ERC-721 interface support, name, and symbol. Publication checks current `ownerOf` and either `getApproved(tokenId)==Seaport` or `isApprovedForAll(owner,Seaport)`.

Circuit orders require one non-criteria `ItemType.ERC721`, amount one, `FULL_OPEN`, zero zone/hash/conduit, and exactly two native considerations. Maker fee is zero; the fee recipient receives an exact 1% taker fee. Circuit capacity is one only for the current owner and becomes zero while a reserving listing exists. Publication rechecks ownership under the repository lock; duplicate hashes remain idempotent.

## Status, worker, and APIs

Periodic revalidation checks owner, approval, counter, Seaport status, signature, expiry, and validator. Owner transfers produce `INVALID_OWNER`; filled orders always take precedence and Circuit orders never become partially filled. `OrderFulfilled` writes quantity one plus seller proceeds, taker fee, and buyer total. Cancellation remains keyed by order hash.

Public endpoints include collection summaries/listings/fills, token listings/fills, account Circuit listings, and per-token listing capacity. Existing ERC-1155 routes and batch quote remain compatible; Circuit assets are rejected from the ERC-1155 batch path. Floor and volume use seller proceeds, never buyer total.

Mining data is deliberately absent from signed orders and persisted validation conditions. It changes independently and is read live by the frontend.

## Deployment and rollback boundary

Deploy migration, compatible API, compatible worker, and frontend in that order. The migration is additive but is not automatically removed during application rollback; take a database backup first. An older application must not run after Circuit rows have been accepted because it does not understand nullable transistor addresses. Circuit writes can be disabled by removing the fee recipient while read paths remain available. Known V1 limits are no offers, auctions, criteria orders, royalties, Circuit batching, or mining-state guarantees.
