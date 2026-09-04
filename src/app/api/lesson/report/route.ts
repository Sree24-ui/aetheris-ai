import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonReportRequestSchema } from "@/lib/schemas/requests";
import { generateReport } from "@/lib/teachingAgent";
import { loadSession } from "@/lib/lessonSessionStore";
import { loadAttempt } from "@/lib/quizStore";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Builds the end-of-lesson report from server-owned evidence (H10).
 *
 * The lesson plan, the checkpoint outcomes and the quiz results all used to
 * arrive in the request body — the plan because the browser was the only
 * place it existed, the outcomes as the browser's own tally, the quiz with
 * the browser's `correct` flags. The model's `scorePercent` was then written
 * into the learner's permanent history.
 *
 * Now the request names a lesson and its assessment, and everything is read
 * from storage. The stored score overrides whatever the model reports: the
 * report is a summary, not the authority.
 */
export const POST = defineRoute(
  {
    name: "lesson-report",
    schema: lessonReportRequestSchema,
    maxBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  async ({ body, userId }) => {
    const session = await loadSession(body.sessionId, userId);
    if (!session) throw new ApiError(404, "notFound", "That lesson could not be found.");

    const attempt = await loadAttempt(body.quizId, userId);
    if (!attempt) {
      throw new ApiError(
        404,
        "notFound",
        "That assessment has not been graded yet, so there is nothing to report on."
      );
    }

    const report = await generateReport({
      lessonPlan: session.plan,
      quizResults: attempt.results.map((result) => ({
        question: result.question,
        conceptTag: result.conceptTag,
        studentAnswer: result.studentAnswer,
        correct: result.correct,
      })),
      checkpointResults: session.checkpointResults.map(({ conceptTag, correct }) => ({
        conceptTag,
        correct,
      })),
      language: session.language,
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
