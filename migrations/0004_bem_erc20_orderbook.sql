ALTER TABLE seaport_listings
  ALTER COLUMN processor_address DROP NOT NULL,
  ALTER COLUMN seller_unit_price_wei DROP NOT NULL,
  ALTER COLUMN taker_fee_per_unit_wei DROP NOT NULL,
  ALTER COLUMN buyer_unit_total_wei DROP NOT NULL,
  ALTER COLUMN seller_total_wei DROP NOT NULL,
  ALTER COLUMN fee_total_wei DROP NOT NULL,
  ALTER COLUMN buyer_total_wei DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS market_pair text,
  ADD COLUMN IF NOT EXISTS order_side text,
  ADD COLUMN IF NOT EXISTS base_token_address text,
  ADD COLUMN IF NOT EXISTS quote_token_address text,
  ADD COLUMN IF NOT EXISTS base_decimals integer,
  ADD COLUMN IF NOT EXISTS quote_decimals integer,
  ADD COLUMN IF NOT EXISTS base_amount_initial numeric(78,0),
  ADD COLUMN IF NOT EXISTS base_amount_remaining numeric(78,0),
  ADD COLUMN IF NOT EXISTS unit_price_quote_atomic numeric(78,0),
  ADD COLUMN IF NOT EXISTS seller_quote_total_atomic numeric(78,0),
  ADD COLUMN IF NOT EXISTS fee_quote_total_atomic numeric(78,0),
  ADD COLUMN IF NOT EXISTS buyer_quote_total_atomic numeric(78,0),
  ADD COLUMN IF NOT EXISTS fill_step_base_atomic numeric(78,0);

ALTER TABLE seaport_listings DROP CONSTRAINT IF EXISTS seaport_listings_asset_standard_check;
ALTER TABLE seaport_listings ADD CONSTRAINT seaport_listings_asset_standard_check
  CHECK (asset_standard IN ('ERC1155', 'ERC721', 'ERC20'));
ALTER TABLE seaport_listings DROP CONSTRAINT IF EXISTS seaport_listings_asset_shape_check;
ALTER TABLE seaport_listings ADD CONSTRAINT seaport_listings_asset_shape_check CHECK (
  (asset_standard = 'ERC1155' AND transistors_address IS NOT NULL AND collection_address = transistors_address AND asset_type IN ('NAND', 'LATCH'))
  OR (asset_standard = 'ERC721' AND transistors_address IS NULL AND asset_type = 'CIRCUIT' AND initial_quantity = 1 AND remaining_quantity IN (0, 1))
  OR (asset_standard = 'ERC20' AND processor_address IS NULL AND transistors_address IS NULL AND asset_type = 'BEM'
      AND market_pair = 'BEM_USDT' AND order_side = 'ASK' AND token_id = 0
      AND lower(base_token_address) = '0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a'
      AND lower(quote_token_address) = '0x55d398326f99059ff775485246999027b3197955'
      AND lower(collection_address) = lower(base_token_address)
      AND base_amount_initial > 0 AND base_amount_remaining >= 0
      AND unit_price_quote_atomic > 0 AND seller_quote_total_atomic > 0
      AND fee_quote_total_atomic > 0 AND buyer_quote_total_atomic = seller_quote_total_atomic + fee_quote_total_atomic
      AND fill_step_base_atomic > 0)
);

ALTER TABLE seaport_fills
  ALTER COLUMN seller_unit_price_wei DROP NOT NULL,
  ALTER COLUMN seller_proceeds_wei DROP NOT NULL,
  ALTER COLUMN taker_fee_wei DROP NOT NULL,
  ALTER COLUMN buyer_total_wei DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS market_pair text,
  ADD COLUMN IF NOT EXISTS base_amount_filled numeric(78,0),
  ADD COLUMN IF NOT EXISTS seller_quote_amount numeric(78,0),
  ADD COLUMN IF NOT EXISTS fee_quote_amount numeric(78,0),
  ADD COLUMN IF NOT EXISTS buyer_quote_amount numeric(78,0),
  ADD COLUMN IF NOT EXISTS unit_price_quote_atomic numeric(78,0);
ALTER TABLE seaport_fills DROP CONSTRAINT IF EXISTS seaport_fills_asset_standard_check;
ALTER TABLE seaport_fills ADD CONSTRAINT seaport_fills_asset_standard_check
  CHECK (asset_standard IN ('ERC1155', 'ERC721', 'ERC20'));
ALTER TABLE seaport_fills DROP CONSTRAINT IF EXISTS seaport_fills_asset_shape_check;
ALTER TABLE seaport_fills ADD CONSTRAINT seaport_fills_asset_shape_check CHECK (
  (asset_standard = 'ERC1155' AND transistors_address IS NOT NULL AND collection_address = transistors_address)
  OR (asset_standard = 'ERC721' AND transistors_address IS NULL AND quantity = 1)
  OR (asset_standard = 'ERC20' AND transistors_address IS NULL AND market_pair = 'BEM_USDT'
      AND lower(collection_address) = '0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a'
      AND base_amount_filled > 0 AND seller_quote_amount > 0 AND fee_quote_amount > 0
      AND buyer_quote_amount = seller_quote_amount + fee_quote_amount AND unit_price_quote_atomic > 0)
);

CREATE INDEX IF NOT EXISTS seaport_listings_bem_active_price_idx
  ON seaport_listings (unit_price_quote_atomic ASC, order_hash ASC)
  WHERE asset_standard='ERC20' AND market_pair='BEM_USDT' AND order_side='ASK' AND status IN ('ACTIVE','PARTIALLY_FILLED');
CREATE INDEX IF NOT EXISTS seaport_listings_bem_seller_idx
  ON seaport_listings (offerer, created_at DESC) WHERE asset_standard='ERC20';
CREATE INDEX IF NOT EXISTS seaport_fills_bem_time_idx
  ON seaport_fills (block_timestamp DESC) WHERE asset_standard='ERC20' AND market_pair='BEM_USDT';
CREATE INDEX IF NOT EXISTS seaport_listings_bem_reserving_idx
  ON seaport_listings (chain_id, offerer, base_token_address, end_time)
  WHERE asset_standard='ERC20' AND status IN ('PENDING_VALIDATION','ACTIVE','PARTIALLY_FILLED','STALE','INVALID_BALANCE','INVALID_APPROVAL');
