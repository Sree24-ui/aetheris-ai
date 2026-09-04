import { ApiError, defineRoute } from "@/lib/apiGuard";
import { mapWithConcurrency } from "@/lib/concurrency";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { quizGradeRequestSchema } from "@/lib/schemas/requests";
import { gradeShortAnswer } from "@/lib/teachingAgent";
import {
  GRADER_VERSION,
  RUBRIC_VERSION,
  gradeMultipleChoice,
  scorePercent,
  unanswered,
  type GradedAnswer,
  type SubmittedAnswer,
} from "@/lib/grading";
import { loadAttempt, loadQuiz, saveAttempt } from "@/lib/quizStore";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Short answers each cost a model call; a small window keeps the burst down. */
const GRADING_CONCURRENCY = 3;

/**
 * Grades a submitted assessment against the stored answer key (H10).
 *
 * Nothing in the request can assert that an answer was right. Multiple choice
 * is decided by option id against the key stored when the quiz was generated
 * — not by string equality, which used to mark an equivalent answer wrong
 * over a trailing full stop. Short answers go to a versioned rubric on the
 * server, with the reference answer never leaving it.
 *
 * Submission is idempotent: the attempt row is keyed by quiz, so a double
 * click or a retry returns the stored outcome rather than re-grading (and
 * re-charging for) the same answers.
 */
export const POST = defineRoute(
  {
    name: "quiz-grade",
    schema: quizGradeRequestSchema,
    maxBytes: 256 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  async ({ body, userId }) => {
    const quiz = await loadQuiz(body.quizId, userId);
    // Owned: another learner's quiz id is a 404, not someone else's marks.
    if (!quiz) throw new ApiError(404, "notFound", "That assessment could not be found.");

    const already = await loadAttempt(body.quizId, userId);
    if (already) {
      return {
        quizId: already.quizId,
        scorePercent: already.scorePercent,
        results: already.results,
        replayed: true,
      };
    }

    const submitted = new Map<string, SubmittedAnswer>(
      body.answers.map((answer) => [answer.questionId, answer])
    );

    const results: GradedAnswer[] = await mapWithConcurrency(
      quiz.questions,
      GRADING_CONCURRENCY,
      async (question) => {
        const answer = submitted.get(question.id);

        if (question.type === "mcq") return gradeMultipleChoice(question, answer);

        const text = (answer?.text ?? "").trim();
        if (text === "" || !question.correctAnswer) return unanswered(question, text);

        const grade = await gradeShortAnswer({
          question: question.question,
          referenceAnswer: question.correctAnswer,
          studentAnswer: text,
          conceptTag: question.conceptTag,
          language: quiz.language,
        });
        return {
          questionId: question.id,
          question: question.question,
          conceptTag: question.conceptTag,
          studentAnswer: text,
          correct: grade.correct,
          partialCredit: grade.partialCredit,
          gradedBy: "rubric" as const,
          feedback: grade.feedback,
        };
      }
    );

    // If any rubric call throws, nothing is stored and the learner can submit
    // again — better than committing a partial mark to a permanent record.
    const { stored, replayed } = await saveAttempt(
      {
        quizId: quiz.id,
        results,
        scorePercent: scorePercent(results),
        graderVersion: GRADER_VERSION,
        rubricVersion: RUBRIC_VERSION,
      },
      userId
    );

    return {
      quizId: stored.quizId,
      scorePercent: stored.scorePercent,
      results: stored.results,
      replayed,
    };
  }
);
