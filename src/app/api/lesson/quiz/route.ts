import { randomUUID } from "crypto";
import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonQuizRequestSchema } from "@/lib/schemas/requests";
import { generateQuiz } from "@/lib/teachingAgent";
import { prepareQuiz, toLearnerQuiz } from "@/lib/grading";
import { saveQuiz } from "@/lib/quizStore";
import { loadSession } from "@/lib/lessonSessionStore";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Generates an assessment and stores it, answer key included.
 *
 * H10: the response used to be the model's output as-is, `correctAnswer` and
 * all, so the key was one network-tab away and grading happened in the
 * browser. The key now stays here; the learner receives a projection with
 * stable question and option ids and nothing else.
 */
export const POST = defineRoute(
  {
    name: "lesson-quiz",
    schema: lessonQuizRequestSchema,
    maxBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  async ({ body, userId, requestId }) => {
    const session = await loadSession(body.sessionId, userId);
    if (!session) throw new ApiError(404, "notFound", "That lesson could not be found.");

    const language = body.language ?? session.language;
    const generated = await generateQuiz({ lessonPlan: session.plan, language });
    const { stored, dropped } = prepareQuiz(generated);

    if (dropped > 0) {
      // Worth a log line: a question whose stated answer is not among its own
      // options means the prompt or the model has drifted.
      console.warn(`[quiz ${requestId}] dropped ${dropped} ungradeable question(s)`);
    }
    if (stored.length === 0) {
      throw new ApiError(
        502,
        "parse",
        "The assessment came back in a form that could not be graded. Try again."
      );
    }

    const quizId = randomUUID();
    await saveQuiz(
      { id: quizId, topic: session.plan.topic, language, questions: stored },
      userId
    );

    return { quizId, questions: toLearnerQuiz(stored) };
  }
);
