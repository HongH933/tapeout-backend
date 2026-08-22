DROP INDEX IF EXISTS seaport_listings_circuit_reserving_unique_idx;

CREATE UNIQUE INDEX seaport_listings_circuit_reserving_unique_idx
  ON seaport_listings (chain_id, offerer, collection_address, token_id)
  WHERE asset_standard = 'ERC721'
    AND status IN ('PENDING_VALIDATION', 'ACTIVE', 'STALE', 'INVALID_OWNER', 'INVALID_APPROVAL');
