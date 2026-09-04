import { Pool } from "pg";
// Shared with db/migrate.mjs so the app and the migration runner can never
// disagree about whether the database certificate is verified.
import { resolveSslConfig } from "../../db/ssl.mjs";

declare global {
  var _pgPool: Pool | undefined;
}

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

// Reuse a single pool across hot reloads in dev and across warm serverless
// invocations, instead of opening a new connection pool per import.
export const pool =
  global._pgPool ??
  new Pool({
    connectionString,
    // H6: remote connections verify the server certificate. See db/ssl.mjs.
    ssl: resolveSslConfig(connectionString),
    // Bounds how much of the database's connection budget one instance can
    // hold, and how long a stuck query can pin a connection open.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000),
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 15_000),
  });

if (process.env.NODE_ENV !== "production") {
  global._pgPool = pool;
}
