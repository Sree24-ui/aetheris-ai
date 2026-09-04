import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { learningPathRequestSchema } from "@/lib/schemas/requests";
import { generateLearningPath } from "@/lib/teachingAgent";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = defineRoute(
  {
    name: "learning-path",
    schema: learningPathRequestSchema,
    maxBytes: 16 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  ({ body }) => generateLearningPath(body)
);
