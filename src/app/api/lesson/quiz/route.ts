import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonQuizRequestSchema } from "@/lib/schemas/requests";
import { generateQuiz } from "@/lib/teachingAgent";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = defineRoute(
  {
    name: "lesson-quiz",
    schema: lessonQuizRequestSchema,
    // A whole lesson plan travels in this body; the schema bounds its shape,
    // this bounds the bytes accepted before parsing starts.
    maxBytes: 1024 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  ({ body }) => generateQuiz(body)
);
