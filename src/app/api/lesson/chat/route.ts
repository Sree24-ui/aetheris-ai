import { MAX_FOLLOW_UPS } from "@/lib/appConfig";
import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonChatRequestSchema } from "@/lib/schemas/requests";
import { answerQuestion } from "@/lib/teachingAgent";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = defineRoute(
  {
    name: "lesson-chat",
    schema: lessonChatRequestSchema,
    maxBytes: 256 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  async ({ body }) => {
    const result = await answerQuestion(body);
    return {
      answer: result.answer,
      suggestedFollowUps: result.suggestedFollowUps.slice(0, MAX_FOLLOW_UPS),
    };
  }
);
