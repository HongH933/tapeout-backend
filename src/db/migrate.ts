import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { createPool } from "./client.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const directory = resolve(process.cwd(), "migrations");
  const migrations = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
  for (const name of migrations) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
    if (applied.rowCount) { console.log(`Migration ${name} already applied`); continue; }
    const sql = await readFile(resolve(directory, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query(sql); await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]); await client.query("COMMIT");
      console.log(`Migration ${name} applied`);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
} finally { await pool.end(); }
