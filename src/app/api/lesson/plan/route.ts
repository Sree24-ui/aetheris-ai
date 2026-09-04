import { randomUUID } from "crypto";
import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonPlanRequestSchema } from "@/lib/schemas/requests";
import { planLesson } from "@/lib/teachingAgent";
import { searchDocument, documentExists } from "@/lib/vectorStore";
import { toLearnerPlan } from "@/lib/lessonState";
import { createSession } from "@/lib/lessonSessionStore";

export const runtime = "nodejs";
// Kept under the 60s ceiling that Vercel's Hobby tier enforces: a higher
// value is not honoured there, and the platform kills the function before
// this route's own timeout fires, leaving nothing useful in the logs.
export const maxDuration = 60;

/**
 * Plans a lesson and opens a durable session for it.
 *
 * The plan used to be returned to the browser and kept only there, so a
 * refresh lost the lesson and every checkpoint answer travelled with it. The
 * full plan is now stored server-side; the response carries the session id,
 * its version, and a projection of the plan with the answer keys removed.
 */
export const POST = defineRoute(
  {
    name: "lesson-plan",
    schema: lessonPlanRequestSchema,
    maxBytes: 16 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  async ({ body, userId }) => {
    const { topic, profile, docId } = body;

    let groundedContext: string | undefined;
    let isDocumentGrounded = false;

    if (docId) {
      // H4: documents are owned. The id comes from the request, the owner
      // comes from the session — a valid UUID from someone else's upload is
      // a 404 here, not a lesson grounded in their material.
      const exists = await documentExists(docId, userId);
      if (!exists) throw new ApiError(404, "notFound", "That document could not be found.");
      const results = await searchDocument(docId, userId, topic);
      groundedContext = results.map((r, i) => `[Excerpt ${i + 1}]\n${r.text}`).join("\n\n");
      isDocumentGrounded = true;
    }

    const plan = await planLesson({ topic, profile, groundedContext, isDocumentGrounded });

    const session = await createSession(
      {
        id: randomUUID(),
        topic: plan.topic,
        language: plan.language,
        profile,
        plan,
        pathTopic: body.pathTopic ?? null,
        pathStepIndex: body.pathStepIndex ?? null,
      },
      userId
    );

    return {
      sessionId: session.id,
      version: session.version,
      plan: toLearnerPlan(plan),
    };
  }
);
