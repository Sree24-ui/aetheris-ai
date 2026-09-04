import { ApiError, defineRoute } from "@/lib/apiGuard";
import { RATE_LIMITS } from "@/lib/security/rateLimit";
import { profilePatchSchema } from "@/lib/schemas/requests";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

export const GET = defineRoute(
  { name: "profile-read", rateLimit: RATE_LIMITS.standard },
  async ({ userId }) => {
    const { rows } = await pool.query<{
      name: string | null;
      email: string | null;
      image: string | null;
      created_at: Date;
    }>(`SELECT name, email, image, created_at FROM users WHERE id = $1`, [userId]);
    const user = rows[0];
    if (!user) throw new ApiError(404, "notFound", "That account could not be found.");
    return {
      name: user.name,
      email: user.email,
      image: user.image,
      createdAt: user.created_at,
    };
  }
);

export const PATCH = defineRoute(
  {
    name: "profile-write",
    schema: profilePatchSchema,
    maxBytes: 4 * 1024,
    rateLimit: RATE_LIMITS.standard,
  },
  async ({ body, userId }) => {
    await pool.query(`UPDATE users SET name = $1 WHERE id = $2`, [body.name, userId]);
    return { ok: true };
  }
);
