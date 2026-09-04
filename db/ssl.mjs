/**
 * TLS configuration for every Postgres connection the project opens.
 *
 * H6: both the app pool and the migration runner used `rejectUnauthorized:
 * false`, which encrypts the connection but authenticates nothing — a network
 * position between the app and the database is enough to impersonate the
 * server and read or rewrite learner data and credentials.
 *
 * Shared by `src/lib/db.ts` and `db/migrate.mjs` (hence plain ESM rather than
 * TypeScript) so the two cannot drift apart.
 */

/** Hosts that are unambiguously the developer's own machine. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/** Returns the host of a Postgres URL, or null when it cannot be parsed. */
export function connectionHost(connectionString) {
  if (typeof connectionString !== "string" || connectionString.length === 0) return null;
  try {
    return new URL(connectionString).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

export function isLocalConnection(connectionString) {
  const host = connectionHost(connectionString);
  return host !== null && LOCAL_HOSTS.has(host);
}

/**
 * Resolves the `ssl` option for `pg`.
 *
 * - Local database: TLS off, because a local Postgres normally has no
 *   certificate at all and requiring one would just stop the project running.
 * - Remote database: TLS **with** certificate verification. A CA bundle can be
 *   supplied through DATABASE_CA_CERT for providers that use a private CA.
 * - `DATABASE_SSL_INSECURE=true`: verification off, honoured only outside
 *   production. In production it throws, so a stray value in a deployment's
 *   environment fails at startup instead of silently downgrading security.
 *
 * @param {string | undefined} connectionString
 * @param {{ nodeEnv?: string, insecure?: string, caCert?: string }} [env]
 */
export function resolveSslConfig(connectionString, env = {}) {
  const nodeEnv = env.nodeEnv ?? process.env.NODE_ENV;
  const insecure = env.insecure ?? process.env.DATABASE_SSL_INSECURE;
  const caCert = env.caCert ?? process.env.DATABASE_CA_CERT;

  if (isLocalConnection(connectionString)) return false;

  if (insecure === "true") {
    if (nodeEnv === "production") {
      throw new Error(
        "DATABASE_SSL_INSECURE=true is refused in production: it disables database " +
          "certificate verification. Remove it, or supply the provider's CA bundle " +
          "in DATABASE_CA_CERT."
      );
    }
    return { rejectUnauthorized: false };
  }

  const ssl = { rejectUnauthorized: true };
  if (caCert && caCert.trim().length > 0) ssl.ca = caCert;
  return ssl;
}
