CREATE TABLE IF NOT EXISTS processors (
  processor_address text PRIMARY KEY, transistors_address text NOT NULL UNIQUE, creator text NOT NULL,
  name text NOT NULL, created_block numeric(78,0) NOT NULL, created_tx text NOT NULL, verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assets (
  chain_id integer NOT NULL, processor_address text NOT NULL REFERENCES processors(processor_address), transistors_address text NOT NULL,
  token_id numeric(78,0) NOT NULL, asset_type text NOT NULL CHECK (asset_type IN ('NAND','LATCH')), verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, transistors_address, token_id)
);
CREATE TABLE IF NOT EXISTS seaport_listings (
  order_hash text PRIMARY KEY, chain_id integer NOT NULL, seaport_address text NOT NULL, offerer text NOT NULL,
  processor_address text NOT NULL, transistors_address text NOT NULL, token_id numeric(78,0) NOT NULL, asset_type text NOT NULL,
  initial_quantity numeric(78,0) NOT NULL, remaining_quantity numeric(78,0) NOT NULL,
  seller_unit_price_wei numeric(78,0) NOT NULL, taker_fee_per_unit_wei numeric(78,0) NOT NULL, buyer_unit_total_wei numeric(78,0) NOT NULL,
  seller_total_wei numeric(78,0) NOT NULL, fee_total_wei numeric(78,0) NOT NULL, buyer_total_wei numeric(78,0) NOT NULL,
  start_time numeric(78,0) NOT NULL, end_time numeric(78,0) NOT NULL, order_type integer NOT NULL, zone text NOT NULL,
  zone_hash text NOT NULL, conduit_key text NOT NULL, counter numeric(78,0) NOT NULL, salt numeric(78,0) NOT NULL,
  parameters_json jsonb NOT NULL, signature text NOT NULL, status text NOT NULL, validation_state text NOT NULL,
  validation_details_json jsonb NOT NULL DEFAULT '{}'::jsonb, validator_codes_json jsonb NOT NULL DEFAULT '{"errors":[],"warnings":[]}'::jsonb,
  last_validated_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seaport_listings_market_active_idx ON seaport_listings (transistors_address, token_id, seller_unit_price_wei) WHERE status IN ('ACTIVE','PARTIALLY_FILLED');
CREATE INDEX IF NOT EXISTS seaport_listings_offerer_idx ON seaport_listings (offerer, created_at DESC);
CREATE TABLE IF NOT EXISTS seaport_fills (
  id bigserial PRIMARY KEY, chain_id integer NOT NULL, order_hash text NOT NULL REFERENCES seaport_listings(order_hash), tx_hash text NOT NULL,
  log_index integer NOT NULL, block_number numeric(78,0) NOT NULL, block_hash text NOT NULL, block_timestamp timestamptz NOT NULL,
  seller text NOT NULL, buyer text NOT NULL, transistors_address text NOT NULL, token_id numeric(78,0) NOT NULL, quantity numeric(78,0) NOT NULL,
  seller_unit_price_wei numeric(78,0) NOT NULL, seller_proceeds_wei numeric(78,0) NOT NULL, taker_fee_wei numeric(78,0) NOT NULL,
  buyer_total_wei numeric(78,0) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(chain_id, tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS sync_checkpoints (
  stream text PRIMARY KEY, block_number numeric(78,0) NOT NULL, block_hash text, updated_at timestamptz NOT NULL DEFAULT now()
);
