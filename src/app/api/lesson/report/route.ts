import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { lessonReportRequestSchema } from "@/lib/schemas/requests";
import { generateReport } from "@/lib/teachingAgent";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = defineRoute(
  {
    name: "lesson-report",
    schema: lessonReportRequestSchema,
    maxBytes: 1024 * 1024,
    rateLimit: RATE_LIMITS.model,
    modelBudget: true,
  },
  ({ body }) => generateReport(body)
);
