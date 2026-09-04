import { ApiError, defineRoute } from "@/lib/apiGuard";
import { deleteAccountRequestSchema } from "@/lib/schemas/requests";
import { deleteAccount } from "@/lib/account";

export const runtime = "nodejs";

/**
 * Account deletion (M13).
 *
 * Everything a learner owns hangs off `users.id` with `ON DELETE CASCADE`, so
 * removing the row removes their history, documents, chunks, embeddings,
 * quizzes, graded attempts, lesson sessions and learning path with it. There
 * is no soft delete and nothing is retained.
 *
 * The learner has to type their own email address back. A one-click
 * irreversible destruction of everything they have done is not a button worth
 * having, and an accidental double-submit of a confirm dialog is exactly how
 * it would happen.
 */
export const DELETE = defineRoute(
  {
    name: "account-delete",
    schema: deleteAccountRequestSchema,
    maxBytes: 4 * 1024,
    rateLimit: { limit: 5, windowMs: 60 * 60_000 },
  },
  async ({ body, userId }) => {
    const deleted = await deleteAccount(userId, body.confirmEmail);
    if (!deleted) {
      throw new ApiError(
        400,
        "validation",
        "That email address does not match this account. Nothing was deleted."
      );
    }
    return { ok: true };
  }
);
