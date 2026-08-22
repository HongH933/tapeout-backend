# Circuit Marketplace deployment

Codex must not execute this production procedure.

1. Back up production PostgreSQL and record the current API and worker revisions.
2. Run `0002_circuit_listings.sql` in staging; inspect its backfill and constraints.
3. Verify legacy ERC-1155 quote, publish, capacity, batch quote, revalidation, summaries, cancellation, and fill indexing.
4. Deploy the Circuit-compatible backend API and verify `/health`, `/ready`, `/api/v1/config`, and the new read routes.
5. Deploy the matching worker; wait for readiness and a advancing checkpoint without indexer errors.
6. Confirm the API/worker use the same chain, canonical Seaport, validator, fee recipient, collections, database, and confirmation count.
7. Deploy the frontend with matching public configuration.
8. Enable the Circuit entry only after read paths, a mock/fork order, and browser QA pass.
9. Monitor HTTP error rates, publish conflicts, invalid-owner/approval transitions, worker lag, RPC errors, and fill/summaries consistency.

Rollback the frontend entry first, then API and worker together. Do not reverse the database migration while Circuit rows exist. Restore from the backup only through an explicitly approved database recovery procedure.
