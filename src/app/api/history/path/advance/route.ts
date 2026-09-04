import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { advancePathRequestSchema } from "@/lib/schemas/requests";
import { NoActivePath, advancePathForUser } from "@/lib/serverMemory";

export const runtime = "nodejs";

/**
 * Moves the learner one step along their path.
 *
 * H8: this used to advance unconditionally, so a duplicate or delayed
 * completion — or a lesson that had nothing to do with the path — pushed
 * progress forward and skipped a step. The caller now names the step the
 * finished lesson belonged to, and the update only applies while the stored
 * index still matches it. A replay changes nothing and reports the position.
 */
export const POST = defineRoute(
  {
    name: "path-advance",
    schema: advancePathRequestSchema,
    maxBytes: 1024,
    rateLimit: RATE_LIMITS.standard,
  },
  async ({ body, userId }) => {
    try {
      return await advancePathForUser(userId, body.fromStepIndex);
    } catch (err) {
      if (err instanceof NoActivePath) {
        throw new ApiError(404, "notFound", err.message);
      }
      throw err;
    }
  }
);
