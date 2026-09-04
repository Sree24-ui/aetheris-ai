import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { deleteDocumentRequestSchema } from "@/lib/schemas/requests";
import { deleteDocumentForUser, listDocumentsForUser } from "@/lib/vectorStore";

export const runtime = "nodejs";

/**
 * The learner's uploaded material (M10).
 *
 * Until now an upload could only be added. "Remove" in the setup form cleared
 * the local selection while the text, chunks and embeddings stayed in the
 * database with no way to get at them.
 */
export const GET = defineRoute(
  { name: "documents-list", rateLimit: RATE_LIMITS.standard },
  async ({ userId }) => ({ documents: await listDocumentsForUser(userId) })
);

export const DELETE = defineRoute(
  {
    name: "documents-delete",
    schema: deleteDocumentRequestSchema,
    maxBytes: 1024,
    rateLimit: RATE_LIMITS.standard,
  },
  async ({ body, userId }) => {
    // Scoped by session: another learner's document id is a 404, and deleting
    // it is not something a guessed UUID can do.
    const deleted = await deleteDocumentForUser(body.docId, userId);
    if (!deleted) throw new ApiError(404, "notFound", "That document could not be found.");
    return { ok: true, docId: body.docId };
  }
);
