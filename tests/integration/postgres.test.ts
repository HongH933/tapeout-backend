import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import pg from "pg";

describe.skipIf(!process.env.TEST_DATABASE_URL)("PostgreSQL migration", () => {
  it("applies the production migration and exposes every required table", async () => { const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL! }); try { await pool.query(await readFile(new URL("../../migrations/0001_initial.sql", import.meta.url), "utf8")); const result = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'"); const tables = result.rows.map((row) => row.tablename); expect(tables).toEqual(expect.arrayContaining(["processors", "assets", "seaport_listings", "seaport_fills", "sync_checkpoints"])); } finally { await pool.end(); } });
});
