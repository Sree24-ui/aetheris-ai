import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonReportRequestSchema } from "@/lib/schemas/requests";
import { generateReport } from "@/lib/teachingAgent";
import { loadAttempt } from "@/lib/quizStore";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Builds the end-of-lesson report from server-owned evidence (H10).
 *
 * The quiz outcome used to arrive in the request body, with the browser's own
 * `correct` flags on it, and the model's `scorePercent` was written straight
 * into the learner's history. Now only a quiz id is accepted, the graded
 * attempt is read from storage, and the stored score overrides whatever the
 * model reports — the report is a summary, not the authority.
 */
export const POST = defineRoute(
  {
    name: "lesson-report",
    schema: lessonReportRequestSchema,
    maxBytes: 1024 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  async ({ body, userId }) => {
    const attempt = await loadAttempt(body.quizId, userId);
    if (!attempt) {
      throw new ApiError(
        404,
        "notFound",
        "That assessment has not been graded yet, so there is nothing to report on."
      );
    }

    const report = await generateReport({
      lessonPlan: body.lessonPlan,
      quizResults: attempt.results.map((result) => ({
        question: result.question,
        conceptTag: result.conceptTag,
        studentAnswer: result.studentAnswer,
        correct: result.correct,
      })),
      checkpointResults: body.checkpointResults,
      language: body.language,
    });

    return {
      ...report,
      // Server-owned, and deliberately last: the model does not get to
      // restate the score.
      scorePercent: attempt.scorePercent,
      graderVersion: attempt.graderVersion,
      rubricVersion: attempt.rubricVersion,
    };
  }
);
