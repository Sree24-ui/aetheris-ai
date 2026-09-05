import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonEvaluateRequestSchema } from "@/lib/schemas/requests";
import { evaluateAnswer } from "@/lib/teachingAgent";
import { applyCommand } from "@/lib/lessonState";
import { loadSession, saveSession } from "@/lib/lessonSessionStore";
import { adaptationFor } from "@/lib/adaptation";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Grades one mid-lesson checkpoint (H10).
 *
 * The request used to carry the question, its reference answer and the
 * section context — all of which had been shipped to the browser inside the
 * lesson plan. It now names a section of a stored lesson; the question, the
 * key and the context are read from the plan the server holds, and the
 * verdict is recorded on the session rather than tallied by the client.
 */
export const POST = defineRoute(
  {
    name: "lesson-evaluate",
    schema: lessonEvaluateRequestSchema,
    maxBytes: 16 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  async ({ body, userId }) => {
    const session = await loadSession(body.sessionId, userId);
    if (!session) throw new ApiError(404, "notFound", "That lesson could not be found.");

    const section = session.plan.sections.find((s) => s.id === body.sectionId);
    if (!section?.checkpoint) {
      throw new ApiError(404, "notFound", "That section has no checkpoint question.");
    }

    // How the lesson has been going, from the outcomes the server recorded —
    // not from anything the browser claims. This is what makes the response
    // adapt to this student rather than to an average one.
    const adaptation = adaptationFor(session.checkpointResults, session.profile);

    const evaluation = await evaluateAnswer({
      question: section.checkpoint,
      studentAnswer: body.studentAnswer,
      sectionContext: section.narration,
      // Follows the language on screen after a mid-lesson switch. Only the
      // wording of the feedback; the question and key are the stored ones.
      language: body.language ?? session.language,
      adaptation,
    });

    // Recorded server-side. Checkpoint outcomes used to be tallied in browser
    // state and posted to the report as a claim.
    const result = applyCommand(
      session,
      {
        type: "checkpoint",
        result: {
          sectionId: section.id,
          conceptTag: section.checkpoint.conceptTag,
          correct: evaluation.correct,
          studentAnswer: body.studentAnswer,
        },
      },
      body.expectedVersion
    );

    // A stale version means the learner answered from a tab that has since
    // fallen behind. The grade still stands — refusing to show it would lose
    // work — but it is not written over newer state.
    let version = session.version;
    if (result.ok && result.changed) {
      const saved = await saveSession(result.state, userId, session.version);
      version = saved ? saved.version : session.version;
    }

    // The stance is returned so the learner can see the teaching adapt rather
    // than only feel it. It describes the answer just given, so it is computed
    // again over the results including it.
    const nextAdaptation = result.ok
      ? adaptationFor(result.state.checkpointResults, session.profile)
      : adaptation;

    return {
      evaluation,
      version,
      recorded: result.ok && result.changed,
      adaptation: {
        stance: nextAdaptation.stance,
        streak: nextAdaptation.streak,
        note: nextAdaptation.note,
      },
    };
  }
);
