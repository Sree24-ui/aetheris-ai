import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonEvaluateRequestSchema } from "@/lib/schemas/requests";
import { evaluateAnswer } from "@/lib/teachingAgent";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = defineRoute(
  {
    name: "lesson-evaluate",
    schema: lessonEvaluateRequestSchema,
    maxBytes: 64 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  ({ body }) => evaluateAnswer(body)
);
