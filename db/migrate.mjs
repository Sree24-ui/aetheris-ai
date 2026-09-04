// Versioned migration runner (M15).
//
// Usage: npm run migrate            apply every pending migration
//        npm run migrate -- --status  list what is applied and what is pending
//
// Run it through the npm script rather than `node db/migrate.mjs` directly:
// the script passes --env-file=.env.local, and without that DATABASE_URL is
// only set if it already happens to be exported in the shell.
//
// The project used to apply one db/schema.sql as a single multi-statement
// query on every run. That works for a first install and nothing else: there
// was no record of what a given database had, no way to review a change as a
// change, and no way to plan a rollback. Migrations now live as immutable
// numbered files under db/migrations/, each applied exactly once inside its
// own transaction and recorded with a checksum. Editing a file that has
// already been applied is treated as an error rather than silently ignored,
// because the two environments would then disagree about what "0002" means.
//
// db/optional/ is deliberately not applied by this runner. What is in there
// changes the database itself (extensions, index types) rather than the
// application's schema, and that is a decision to take deliberately per
// environment — see the header of each file.
import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import path from "path";
import pg from "pg";
import { resolveSslConfig } from "./ssl.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Schema changes are applied as multi-statement transactions. Neon's pooled
// endpoint runs PgBouncer in transaction mode, which is a poor fit for that,
// so prefer the direct (unpooled) endpoint when one is configured.
function resolveConnectionString() {
  return (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  );
}

/** Every migration on disk, in the order its filename sorts. */
export function readMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => {
      const sql = readFileSync(path.join(dir, name), "utf-8");
      return {
        version: name.replace(/\.sql$/, ""),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
}

/**
 * Decides what to do, given what is on disk and what the database has already
 * applied. Pure, so the interesting cases are testable without a database.
 */
export function planMigrations(onDisk, applied) {
  const appliedByVersion = new Map(applied.map((row) => [row.version, row.checksum]));
  const pending = [];
  const changed = [];
  for (const migration of onDisk) {
    const knownChecksum = appliedByVersion.get(migration.version);
    if (knownChecksum === undefined) {
      pending.push(migration);
    } else if (knownChecksum !== migration.checksum) {
      changed.push(migration.version);
    }
  }
  const missing = applied
    .map((row) => row.version)
    .filter((version) => !onDisk.some((m) => m.version === version));
  return { pending, changed, missing };
}

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

async function main() {
  const statusOnly = process.argv.includes("--status");
  // Resolved here rather than at import time, so importing this file for its
  // pure helpers (the tests do) never touches the environment or exits.
  const connectionString = resolveConnectionString();
  if (!connectionString) {
    throw new Error("DATABASE_URL (or POSTGRES_URL) is not set.");
  }
  const client = new pg.Client({
    connectionString,
    ssl: resolveSslConfig(connectionString),
  });
  await client.connect();
  try {
    await client.query(MIGRATIONS_TABLE);
    const { rows: applied } = await client.query(
      `SELECT version, checksum FROM schema_migrations ORDER BY version`
    );
    const onDisk = readMigrations();
    const { pending, changed, missing } = planMigrations(onDisk, applied);

    if (changed.length > 0) {
      throw new Error(
        `These migrations were edited after being applied: ${changed.join(", ")}. ` +
          `A migration is immutable once it has run — add a new one instead.`
      );
    }
    if (missing.length > 0) {
      console.warn(
        `Warning: the database has migrations this checkout does not: ${missing.join(", ")}. ` +
          `You are probably on an older branch than the database.`
      );
    }

    if (statusOnly) {
      for (const row of applied) console.log(`applied  ${row.version}`);
      for (const migration of pending) console.log(`pending  ${migration.version}`);
      if (applied.length === 0 && pending.length === 0) console.log("No migrations found.");
      return;
    }

    if (pending.length === 0) {
      console.log("Database is up to date.");
      return;
    }

    for (const migration of pending) {
      process.stdout.write(`applying ${migration.version} ... `);
      // One transaction per migration: a failure leaves the database on the
      // last complete version rather than half-way through this one.
      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)`,
          [migration.version, migration.checksum]
        );
        await client.query("COMMIT");
        console.log("ok");
      } catch (err) {
        await client.query("ROLLBACK");
        console.log("failed");
        throw err;
      }
    }
    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

// Importing this file (the tests do, for planMigrations) must not connect.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Migration failed:", err.message);
    process.exitCode = 1;
  });
}
