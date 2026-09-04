import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { pool } from "@/lib/db";
import { snapshot } from "@/lib/providers/circuitBreaker";
import { activeModel, activeProvider } from "@/lib/llm";

export const runtime = "nodejs";

/**
 * Operational health (H12).
 *
 * Authenticated on purpose. It reports which model backends are failing and
 * how the database is responding, which is exactly the reconnaissance an
 * unauthenticated probe should not get. A load balancer's liveness check can
 * use the root page; this is for whoever is on call.
 */
export const GET = defineRoute(
  { name: "health", rateLimit: RATE_LIMITS.standard },
  async ({ requestId }) => {
    const startedAt = Date.now();
    let database: "up" | "down" = "up";
    let databaseMs: number | null = null;
    try {
      await pool.query("SELECT 1");
      databaseMs = Date.now() - startedAt;
    } catch (err) {
      // The driver's message can carry the host and user; it stays in the log.
      console.error(`[health ${requestId}] database check failed`, err);
      database = "down";
    }

    const providers = snapshot();
    const degraded = database === "down" || providers.some((p) => p.state === "open");

    return {
      status: degraded ? "degraded" : "ok",
      requestId,
      database,
      databaseMs,
      model: { provider: activeProvider(), id: activeModel() },
      providers,
    };
  }
);
