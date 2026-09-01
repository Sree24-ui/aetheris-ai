import { Pool } from "pg";

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
    ssl: connectionString?.includes("localhost") ? false : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  global._pgPool = pool;
}
