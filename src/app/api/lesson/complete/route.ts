import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonCompleteRequestSchema } from "@/lib/schemas/requests";
import { completeLesson } from "@/lib/lessonSessionStore";
import { loadAttempt } from "@/lib/quizStore";

export const runtime = "nodejs";

/**
 * Commits a finished lesson (H8).
 *
 * Completion used to be three independent client requests — write history,
 * reload memory, advance the path — any of which could fail on its own,
 * leaving a lesson in the history with the path not advanced, or the reverse.
 * It is now one transaction, and one that is safe to retry: the session's
 * status records whether this lesson was already committed, and the history
 * row is written against an id the client reuses across attempts.
 *
 * The score is not accepted from the request. It is read from the graded
 * attempt the server stored.
 */
export const POST = defineRoute(
  {
    name: "lesson-complete",
    schema: lessonCompleteRequestSchema,
    maxBytes: 512 * 1024,
    rateLimit: RATE_LIMITS.standard,
  },
  async ({ body, userId }) => {
    const attempt = await loadAttempt(body.quizId, userId);
    if (!attempt) {
      throw new ApiError(
        404,
        "notFound",
        "That assessment has not been graded yet, so the lesson cannot be completed."
      );
    }

    const outcome = await completeLesson(
      {
        sessionId: body.sessionId,
        expectedVersion: body.expectedVersion,
        quizId: body.quizId,
        history: {
          id: body.historyId,
          topic: "",
          date: new Date().toISOString(),
          language: "",
          strongAreas: body.report.strongAreas,
          weakAreas: body.report.weakAreas,
          recommendation: body.report.recommendation,
          transcript: body.transcript,
          quiz: attempt.results.map((result) => ({
            question: result.question,
            studentAnswer: result.studentAnswer,
            correct: result.correct,
          })),
          scorePercent: attempt.scorePercent,
        },
      },
      userId
    );

    if ("conflict" in outcome) {
      if (outcome.conflict === "not-found") {
        throw new ApiError(404, "notFound", "That lesson could not be found.");
      }
      throw new ApiError(
        409,
        "validation",
        "This lesson has moved on since that request was made. Reload to catch up."
      );
    }

    return {
      historyId: outcome.historyId,
      pathStepIndex: outcome.pathStepIndex,
      pathAdvanced: outcome.pathAdvanced,
      replayed: outcome.replayed,
      scorePercent: attempt.scorePercent,
    };
  }
);
