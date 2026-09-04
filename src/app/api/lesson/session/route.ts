import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonCommandRequestSchema } from "@/lib/schemas/requests";
import { applyCommand, toLearnerPlan } from "@/lib/lessonState";
import { loadActiveSession, loadSession, saveSession } from "@/lib/lessonSessionStore";

export const runtime = "nodejs";

/**
 * The lesson in flight.
 *
 * GET is what makes a refresh resume rather than restart, and what lets a
 * second device pick the lesson up: the plan, the position, the transcript and
 * the checkpoint results all come back from the server, which owns them.
 *
 * POST applies one command under an optimistic version check.
 */
export const GET = defineRoute(
  { name: "lesson-session-read", rateLimit: RATE_LIMITS.standard },
  async ({ userId }) => {
    const session = await loadActiveSession(userId);
    if (!session) return { session: null };
    return { session: publicView(session) };
  }
);

export const POST = defineRoute(
  {
    name: "lesson-session-command",
    schema: lessonCommandRequestSchema,
    maxBytes: 512 * 1024,
    rateLimit: RATE_LIMITS.standard,
  },
  async ({ body, userId }) => {
    const session = await loadSession(body.sessionId, userId);
    if (!session) throw new ApiError(404, "notFound", "That lesson could not be found.");

    const result = applyCommand(session, body.command, body.expectedVersion);
    if (!result.ok) {
      // A refused command hands back the real state so the caller can
      // reconcile instead of guessing.
      throw new ApiError(
        409,
        "validation",
        `That change no longer applies to this lesson (${result.reason}). Reload to catch up.`
      );
    }
    if (!result.changed) return { session: publicView(result.state), changed: false };

    const saved = await saveSession(result.state, userId, session.version);
    if (!saved) {
      // Lost a race with another request that wrote first.
      throw new ApiError(409, "validation", "That change no longer applies to this lesson.");
    }
    return { session: publicView(saved), changed: true };
  }
);

/** Everything the browser may see. The plan's answer keys are removed here. */
function publicView(session: Awaited<ReturnType<typeof loadSession>>) {
  if (!session) return null;
  return {
    id: session.id,
    status: session.status,
    topic: session.topic,
    language: session.language,
    profile: session.profile,
    plan: toLearnerPlan(session.plan),
    pathTopic: session.pathTopic,
    pathStepIndex: session.pathStepIndex,
    currentSectionIndex: session.currentSectionIndex,
    checkpointResults: session.checkpointResults,
    transcript: session.transcript,
    sources: session.sources,
    version: session.version,
  };
}
