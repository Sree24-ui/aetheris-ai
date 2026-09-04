import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { historyEntryRequestSchema } from "@/lib/schemas/requests";
import { ApiError } from "@/lib/apiGuard";
import {
  HistoryIdConflict,
  addHistoryEntryForUser,
  loadMemoryForUser,
} from "@/lib/serverMemory";

export const runtime = "nodejs";

export const GET = defineRoute(
  { name: "history-read", rateLimit: RATE_LIMITS.standard },
  ({ userId }) => loadMemoryForUser(userId)
);

export const POST = defineRoute(
  {
    name: "history-write",
    schema: historyEntryRequestSchema,
    maxBytes: 1024 * 1024,
    rateLimit: RATE_LIMITS.standard,
  },
  async ({ body, userId }) => {
    // The row is written against the session's user id; nothing in the body
    // can name a different owner. Re-sending the same entry id is a replay,
    // not a second lesson, so a retry after a timeout is safe.
    try {
      return await addHistoryEntryForUser(userId, body);
    } catch (err) {
      if (err instanceof HistoryIdConflict) {
        throw new ApiError(409, "validation", err.message);
      }
      throw err;
    }
  }
);
