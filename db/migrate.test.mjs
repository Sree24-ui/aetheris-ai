import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planMigrations, readMigrations } from "./migrate.mjs";

/**
 * Regression tests for M15. The project applied one schema.sql on every run,
 * so there was no record of what a given database had, no way to review a
 * change as a change, and nothing stopping an already-applied file being
 * edited underneath an environment that had run the old version.
 */

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

test("migrations are read in filename order with a checksum each", () => {
  const migrations = readMigrations(MIGRATIONS_DIR);
  assert.ok(migrations.length >= 3, "expected the baseline plus later migrations");
  const versions = migrations.map((m) => m.version);
  assert.deepEqual(versions, [...versions].sort(), "not in sorted order");
  assert.equal(versions[0], "0001_baseline");
  for (const migration of migrations) {
    assert.match(migration.checksum, /^[0-9a-f]{64}$/);
    assert.ok(migration.sql.length > 0);
  }
});

test("every migration has a distinct version and checksum", () => {
  const migrations = readMigrations(MIGRATIONS_DIR);
  assert.equal(new Set(migrations.map((m) => m.version)).size, migrations.length);
  assert.equal(new Set(migrations.map((m) => m.checksum)).size, migrations.length);
});

const a = { version: "0001_a", sql: "select 1", checksum: "aaa" };
const b = { version: "0002_b", sql: "select 2", checksum: "bbb" };

test("a fresh database applies everything, in order", () => {
  const plan = planMigrations([a, b], []);
  assert.deepEqual(plan.pending.map((m) => m.version), ["0001_a", "0002_b"]);
  assert.deepEqual(plan.changed, []);
  assert.deepEqual(plan.missing, []);
});

test("an up-to-date database applies nothing", () => {
  const plan = planMigrations(
    [a, b],
    [
      { version: "0001_a", checksum: "aaa" },
      { version: "0002_b", checksum: "bbb" },
    ]
  );
  assert.deepEqual(plan.pending, []);
});

test("only the migrations the database lacks are pending", () => {
  const plan = planMigrations([a, b], [{ version: "0001_a", checksum: "aaa" }]);
  assert.deepEqual(plan.pending.map((m) => m.version), ["0002_b"]);
});

test("editing an applied migration is reported, not silently ignored", () => {
  // Two environments would otherwise disagree about what "0001_a" means.
  const plan = planMigrations([a, b], [{ version: "0001_a", checksum: "different" }]);
  assert.deepEqual(plan.changed, ["0001_a"]);
  assert.deepEqual(plan.pending.map((m) => m.version), ["0002_b"]);
});

test("a database ahead of the checkout is reported as such", () => {
  const plan = planMigrations([a], [
    { version: "0001_a", checksum: "aaa" },
    { version: "0009_from_another_branch", checksum: "zzz" },
  ]);
  assert.deepEqual(plan.missing, ["0009_from_another_branch"]);
  assert.deepEqual(plan.pending, []);
});
