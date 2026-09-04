import { randomUUID } from "crypto";
import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonQuizRequestSchema } from "@/lib/schemas/requests";
import { generateQuiz } from "@/lib/teachingAgent";
import { prepareQuiz, toLearnerQuiz } from "@/lib/grading";
import { saveQuiz } from "@/lib/quizStore";

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
    // A whole lesson plan travels in this body; the schema bounds its shape,
    // this bounds the bytes accepted before parsing starts.
    maxBytes: 1024 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  async ({ body, userId, requestId }) => {
    const generated = await generateQuiz(body);
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
      { id: quizId, topic: body.lessonPlan.topic, language: body.language, questions: stored },
      userId
    );

    return { quizId, questions: toLearnerQuiz(stored) };
  }
);
