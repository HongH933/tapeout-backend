import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { createPool } from "./client.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  const sql = await readFile(resolve(process.cwd(), "migrations/0001_initial.sql"), "utf8");
  await pool.query(sql);
  console.log("Migration 0001_initial applied");
} finally { await pool.end(); }
