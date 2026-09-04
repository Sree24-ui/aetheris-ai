import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { exportAccount } from "@/lib/account";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Data export (M13).
 *
 * Everything the account holds, as one JSON document: profile, lesson
 * history with transcripts, learning path, uploaded document metadata, and
 * graded assessments. Chunk embeddings are deliberately excluded — they are
 * derived, enormous, and meaningless outside this application's embedding
 * model; the document text they came from is included instead.
 */
export const GET = defineRoute(
  { name: "account-export", rateLimit: RATE_LIMITS.upload },
  async ({ userId }) => {
    const data = await exportAccount(userId);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="aetheris-export-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
      },
    });
  }
);
