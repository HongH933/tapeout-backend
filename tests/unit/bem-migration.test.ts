import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("0004 BEM ERC-20 migration", () => {
  const sql = readFileSync(new URL("../../migrations/0004_bem_erc20_orderbook.sql", import.meta.url), "utf8");

  it("is additive and keeps old migrations untouched", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS market_pair");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS base_amount_remaining");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS seller_quote_amount");
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
  });

  it("enforces BEM ASK identity and creates price, seller, fill and reserving indexes", () => {
    expect(sql).toContain("asset_standard = 'ERC20'");
    expect(sql).toContain("market_pair = 'BEM_USDT'");
    expect(sql).toContain("order_side = 'ASK'");
    expect(sql).toContain("seaport_listings_bem_active_price_idx");
    expect(sql).toContain("seaport_listings_bem_seller_idx");
    expect(sql).toContain("seaport_fills_bem_time_idx");
    expect(sql).toContain("seaport_listings_bem_reserving_idx");
  });
});
