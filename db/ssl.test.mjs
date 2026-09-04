import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionHost, isLocalConnection, resolveSslConfig } from "./ssl.mjs";

/**
 * Regression tests for H6. Both the pool and the migration runner passed
 * `rejectUnauthorized: false`, which encrypts the connection to the database
 * without ever checking who is on the other end of it.
 */

const NEON = "postgresql://user:pw@ep-cool-name.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgresql://postgres:postgres@localhost:5432/aetheris";

test("hosts are read out of the connection string", () => {
  assert.equal(connectionHost(NEON), "ep-cool-name.eu-central-1.aws.neon.tech");
  assert.equal(connectionHost(LOCAL), "localhost");
  assert.equal(connectionHost("not a url"), null);
  assert.equal(connectionHost(undefined), null);
});

test("only genuine loopback addresses count as local", () => {
  assert.equal(isLocalConnection(LOCAL), true);
  assert.equal(isLocalConnection("postgres://u@127.0.0.1:5432/db"), true);
  assert.equal(isLocalConnection("postgres://u@[::1]:5432/db"), true);
  assert.equal(isLocalConnection(NEON), false);
  // The old check was `connectionString.includes("localhost")`, which a
  // hostname like this satisfies while pointing at the public internet.
  assert.equal(isLocalConnection("postgres://u@localhost.evil.example/db"), false);
});

test("a remote connection verifies the server certificate", () => {
  const ssl = resolveSslConfig(NEON, { nodeEnv: "production" });
  assert.deepEqual(ssl, { rejectUnauthorized: true });
});

test("a supplied CA bundle is attached to the verified config", () => {
  const ssl = resolveSslConfig(NEON, { nodeEnv: "production", caCert: "-----BEGIN CERTIFICATE-----" });
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.ca, "-----BEGIN CERTIFICATE-----");
});

test("a local connection needs no TLS at all", () => {
  assert.equal(resolveSslConfig(LOCAL, { nodeEnv: "development" }), false);
});

test("the insecure escape hatch works only outside production", () => {
  assert.deepEqual(resolveSslConfig(NEON, { nodeEnv: "development", insecure: "true" }), {
    rejectUnauthorized: false,
  });
});

test("the insecure escape hatch is refused in production", () => {
  assert.throws(
    () => resolveSslConfig(NEON, { nodeEnv: "production", insecure: "true" }),
    /refused in production/
  );
});

test("any value other than the exact opt-in keeps verification on", () => {
  for (const insecure of ["false", "TRUE", "1", "yes", ""]) {
    assert.deepEqual(resolveSslConfig(NEON, { nodeEnv: "development", insecure }), {
      rejectUnauthorized: true,
    });
  }
});
