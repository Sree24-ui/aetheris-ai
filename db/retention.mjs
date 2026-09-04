// Retention sweep for uploaded material (M10).
//
// Usage: npm run retention                 report what is past retention
//        npm run retention -- --apply      delete it
//        npm run retention -- --days 30    use a different window
//
// The default window comes from DOCUMENT_RETENTION_DAYS, or 90 days.
//
// Deliberately not scheduled by the application: choosing where a recurring
// job runs is an infrastructure decision, and a deletion sweep that fires
// from whichever serverless instance happens to be warm is not one worth
// having. Point a scheduler (cron, a platform cron job, a CI schedule) at
// this script once, and it will do the same thing every time.
//
// Deleting a document takes its chunks and embeddings with it through the
// foreign key's ON DELETE CASCADE. Nothing derived is left behind.
import pg from "pg";
import { resolveSslConfig } from "./ssl.mjs";

const apply = process.argv.includes("--apply");
const daysFlag = process.argv.indexOf("--days");
const days = Number(
  daysFlag !== -1 ? process.argv[daysFlag + 1] : process.env.DOCUMENT_RETENTION_DAYS ?? 90
);

if (!Number.isInteger(days) || days < 1 || days > 3650) {
  console.error(`Retention window must be a whole number of days between 1 and 3650 (got ${days}).`);
  process.exit(1);
}

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL;
if (!connectionString) {
  console.error("DATABASE_URL (or POSTGRES_URL) is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString, ssl: resolveSslConfig(connectionString) });
await client.connect();
try {
  const cutoff = `${days} days`;
  const { rows } = await client.query(
    `SELECT id, filename, created_at
       FROM documents
      WHERE created_at < now() - $1::interval
      ORDER BY created_at`,
    [cutoff]
  );

  if (rows.length === 0) {
    console.log(`No documents older than ${days} days.`);
  } else if (!apply) {
    console.log(`${rows.length} document(s) older than ${days} days (dry run):`);
    for (const row of rows) {
      console.log(`  ${row.id}  ${row.created_at.toISOString().slice(0, 10)}  ${row.filename}`);
    }
    console.log("Re-run with --apply to delete them.");
  } else {
    const deleted = await client.query(
      `DELETE FROM documents WHERE created_at < $1::timestamptz`,
      [new Date(Date.now() - days * 86_400_000)]
    );
    console.log(`Deleted ${deleted.rowCount} document(s) and their chunks.`);
  }
} catch (err) {
  console.error("Retention sweep failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
