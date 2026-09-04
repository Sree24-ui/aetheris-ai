import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { setPathRequestSchema } from "@/lib/schemas/requests";
import { setCurrentPathForUser } from "@/lib/serverMemory";

export const runtime = "nodejs";

export const POST = defineRoute(
  {
    name: "path-set",
    schema: setPathRequestSchema,
    maxBytes: 64 * 1024,
    rateLimit: RATE_LIMITS.standard,
  },
  async ({ body, userId }) => {
    // H8: the index is clamped to a real step of the path being saved, so a
    // crafted request cannot park progress past the end of the curriculum.
    const stepIndex = Math.min(body.stepIndex, body.path.steps.length - 1);
    await setCurrentPathForUser(userId, body.path, stepIndex);
    return { ok: true, stepIndex };
  }
);
