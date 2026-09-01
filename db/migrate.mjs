// One-off migration runner: applies db/schema.sql against DATABASE_URL.
// Usage: node db/migrate.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("DATABASE_URL (or POSTGRES_URL) is not set.");
  process.exit(1);
}

const sql = readFileSync(path.join(__dirname, "schema.sql"), "utf-8");

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log("Schema applied successfully.");
} catch (err) {
  console.error("Migration failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
