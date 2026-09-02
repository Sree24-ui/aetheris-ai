// One-off migration runner: applies db/schema.sql against DATABASE_URL.
// Usage: npm run migrate
//
// Run it through the npm script rather than `node db/migrate.mjs` directly:
// the script passes --env-file=.env.local, and without that DATABASE_URL is
// only set if it already happens to be exported in the shell.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Schema.sql is applied as one multi-statement query. Neon's pooled endpoint
// runs PgBouncer in transaction mode, which is a poor fit for that, so prefer
// the direct (unpooled) endpoint when one is configured and fall back to the
// pooled URL otherwise.
const connectionString =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;
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
