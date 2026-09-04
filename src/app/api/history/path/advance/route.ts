import { defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { advancePathForUser } from "@/lib/serverMemory";

export const runtime = "nodejs";

export const POST = defineRoute(
  { name: "path-advance", rateLimit: RATE_LIMITS.standard },
  ({ userId }) => advancePathForUser(userId)
);
