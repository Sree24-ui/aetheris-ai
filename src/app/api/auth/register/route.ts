import bcrypt from "bcryptjs";
import { ApiError, defineRoute } from "@/lib/apiGuard";
import { pool } from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/appConfig";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { registerRequestSchema } from "@/lib/schemas/requests";

export const runtime = "nodejs";

/**
 * Account creation is the one endpoint that must work without a session, so
 * it is rate limited by client address instead of user id — otherwise it is
 * an unauthenticated way to make the server compute bcrypt hashes.
 */
export const POST = defineRoute(
  {
    name: "register",
    requireAuth: false,
    schema: registerRequestSchema(MIN_PASSWORD_LENGTH),
    maxBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.register,
  },
  async ({ body }) => {
    const { name, email, password } = body;
    try {
      const existing = await pool.query(`SELECT id FROM users WHERE email = $1`, [email]);
      if (existing.rows.length > 0) {
        throw new ApiError(409, "validation", "An account with that email already exists.");
      }

      const hashed = await bcrypt.hash(password, 12);
      await pool.query(`INSERT INTO users (name, email, password) VALUES ($1, $2, $3)`, [
        name,
        email,
        hashed,
      ]);
      return { ok: true };
    } catch (err) {
      if (err instanceof ApiError) throw err;
      // With DATABASE_URL unset, `pg` quietly falls back to localhost:5432 and
      // the failure surfaces as a connection error. Naming that beats "failed
      // to create account", which reads as though the details were rejected.
      // Only these two recognised setup mistakes are described; anything else
      // becomes the generic 500 so driver internals stay server-side.
      const code = (err as { code?: string }).code;
      if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
        throw new ApiError(
          503,
          "network",
          "Could not reach the database. Check that DATABASE_URL is set and the schema has been applied (npm run migrate)."
        );
      }
      if (code === "42P01") {
        throw new ApiError(
          503,
          "network",
          "The database is reachable but the tables are missing. Run: npm run migrate"
        );
      }
      throw err;
    }
  }
);
