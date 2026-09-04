import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonPlanRequestSchema } from "@/lib/schemas/requests";
import { planLesson } from "@/lib/teachingAgent";
import { searchDocument, documentExists } from "@/lib/vectorStore";

export const runtime = "nodejs";
// Kept under the 60s ceiling that Vercel's Hobby tier enforces: a higher
// value is not honoured there, and the platform kills the function before
// this route's own timeout fires, leaving nothing useful in the logs.
export const maxDuration = 60;

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

    return planLesson({ topic, profile, groundedContext, isDocumentGrounded });
  }
);
