import { defineRoute } from "@/lib/apiGuard";
import { translateSectionRequestSchema } from "@/lib/schemas/requests";
import { translateSection } from "@/lib/teachingAgent";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = defineRoute(
  {
    name: "lesson-translate",
    schema: translateSectionRequestSchema,
    maxBytes: 256 * 1024,
    // A language switch fans out one request per section, so this limit has
    // to clear a whole lesson's worth in a minute while still bounding abuse.
    rateLimit: { limit: 40, windowMs: 60_000 },
    modelBudget: true,
  },
  ({ body }) => translateSection(body)
);
