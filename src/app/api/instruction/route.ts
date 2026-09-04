import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { instructionRequestSchema } from "@/lib/schemas/requests";
import { parseInstruction } from "@/lib/teachingAgent";

export const runtime = "nodejs";

// H4: authentication is enforced here, not only by the proxy — this endpoint
// spends model quota, so a gap in proxy coverage would be directly billable.
export const POST = defineRoute(
  {
    name: "instruction",
    schema: instructionRequestSchema,
    maxBytes: 8 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  ({ body }) => parseInstruction(body.text)
);
