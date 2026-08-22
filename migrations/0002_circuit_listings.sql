ALTER TABLE seaport_listings
  ADD COLUMN IF NOT EXISTS asset_standard text NOT NULL DEFAULT 'ERC1155',
  ADD COLUMN IF NOT EXISTS collection_address text;

UPDATE seaport_listings
SET collection_address = transistors_address
WHERE collection_address IS NULL;

ALTER TABLE seaport_listings
  ALTER COLUMN collection_address SET NOT NULL,
  ALTER COLUMN transistors_address DROP NOT NULL;

ALTER TABLE seaport_listings
  DROP CONSTRAINT IF EXISTS seaport_listings_asset_standard_check;
ALTER TABLE seaport_listings
  ADD CONSTRAINT seaport_listings_asset_standard_check
  CHECK (asset_standard IN ('ERC1155', 'ERC721'));

ALTER TABLE seaport_listings
  DROP CONSTRAINT IF EXISTS seaport_listings_asset_shape_check;
ALTER TABLE seaport_listings
  ADD CONSTRAINT seaport_listings_asset_shape_check CHECK (
    (asset_standard = 'ERC1155' AND transistors_address IS NOT NULL AND collection_address = transistors_address AND asset_type IN ('NAND', 'LATCH'))
    OR
    (asset_standard = 'ERC721' AND transistors_address IS NULL AND asset_type = 'CIRCUIT' AND initial_quantity = 1 AND remaining_quantity IN (0, 1))
  );

ALTER TABLE seaport_fills
  ADD COLUMN IF NOT EXISTS asset_standard text NOT NULL DEFAULT 'ERC1155',
  ADD COLUMN IF NOT EXISTS collection_address text;

UPDATE seaport_fills
SET collection_address = transistors_address
WHERE collection_address IS NULL;

ALTER TABLE seaport_fills
  ALTER COLUMN collection_address SET NOT NULL,
  ALTER COLUMN transistors_address DROP NOT NULL;

CREATE OR REPLACE FUNCTION seaport_asset_compat_backfill()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.asset_standard = 'ERC1155' AND NEW.collection_address IS NULL THEN
    NEW.collection_address := NEW.transistors_address;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seaport_listings_asset_compat_backfill ON seaport_listings;
CREATE TRIGGER seaport_listings_asset_compat_backfill
  BEFORE INSERT OR UPDATE ON seaport_listings
  FOR EACH ROW EXECUTE FUNCTION seaport_asset_compat_backfill();

DROP TRIGGER IF EXISTS seaport_fills_asset_compat_backfill ON seaport_fills;
CREATE TRIGGER seaport_fills_asset_compat_backfill
  BEFORE INSERT OR UPDATE ON seaport_fills
  FOR EACH ROW EXECUTE FUNCTION seaport_asset_compat_backfill();

ALTER TABLE seaport_fills
  DROP CONSTRAINT IF EXISTS seaport_fills_asset_standard_check;
ALTER TABLE seaport_fills
  ADD CONSTRAINT seaport_fills_asset_standard_check
  CHECK (asset_standard IN ('ERC1155', 'ERC721'));

ALTER TABLE seaport_fills
  DROP CONSTRAINT IF EXISTS seaport_fills_asset_shape_check;
ALTER TABLE seaport_fills
  ADD CONSTRAINT seaport_fills_asset_shape_check CHECK (
    (asset_standard = 'ERC1155' AND transistors_address IS NOT NULL AND collection_address = transistors_address)
    OR
    (asset_standard = 'ERC721' AND transistors_address IS NULL AND quantity = 1)
  );

CREATE INDEX IF NOT EXISTS seaport_listings_circuit_active_idx
  ON seaport_listings (collection_address, seller_unit_price_wei, order_hash)
  WHERE asset_standard = 'ERC721' AND status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS seaport_fills_circuit_activity_idx
  ON seaport_fills (collection_address, token_id, block_timestamp DESC)
  WHERE asset_standard = 'ERC721';

CREATE UNIQUE INDEX IF NOT EXISTS seaport_listings_circuit_reserving_unique_idx
  ON seaport_listings (chain_id, offerer, collection_address, token_id)
  WHERE asset_standard = 'ERC721'
    AND status IN ('PENDING_VALIDATION', 'ACTIVE', 'STALE', 'INVALID_APPROVAL');
