import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { historyEntryRequestSchema } from "@/lib/schemas/requests";
import { loadMemoryForUser, addHistoryEntryForUser } from "@/lib/serverMemory";

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
    // can name a different owner.
    await addHistoryEntryForUser(userId, body);
    return { ok: true, id: body.id };
  }
);
