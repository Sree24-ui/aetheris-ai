import type { NextRequest } from "next/server";
import type { ZodType } from "zod";
import { auth } from "./auth";
import {
  ApiError,
  enforceModelBudget,
  enforceRateLimit,
  newRequestId,
  readValidatedBody,
  jsonResponse,
  toSafeErrorResponse,
  type RateLimitSpec,
} from "./security/http";
import { clientAddress } from "./security/http";

export {
  ApiError,
  clientAddress,
  enforceModelBudget,
  enforceRateLimit,
  jsonResponse,
  newRequestId,
  readValidatedBody,
  toSafeErrorResponse,
  DEFAULT_MAX_BODY_BYTES,
} from "./security/http";
export type { ApiErrorBody, RateLimitSpec } from "./security/http";

/**
 * One place where every API route establishes identity, validates its body,
 * spends its rate-limit budget and turns failures into safe responses.
 *
 * H4: route protection used to live only in the proxy. A matcher that stops
 * matching, an internal call, or a platform that bypasses the proxy layer all
 * silently un-gated seven model-spending endpoints. Every sensitive handler
 * now resolves the session itself, and the proxy remains as an outer
 * perimeter rather than the only one.
 */

/**
 * The signed-in user's id, or a 401.
 *
 * The id comes from the verified session only. Nothing in the request body,
 * query string or headers can name a different user, which is what stops one
 * learner reading another's history by editing a payload.
 */
export async function requireUserId(): Promise<number> {
  const session = await auth();
  const userId = Number(session?.user?.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new ApiError(401, "auth", "You need to be signed in to do that.");
  }
  return userId;
}

export interface RouteContext<TBody> {
  req: NextRequest;
  body: TBody;
  userId: number;
  requestId: string;
}

export interface RouteConfig<TBody> {
  /** Rate-limit namespace and log prefix. */
  name: string;
  /** Set false only for genuinely public endpoints (registration). */
  requireAuth?: boolean;
  schema?: ZodType<TBody>;
  maxBytes?: number;
  rateLimit?: Omit<RateLimitSpec, "name">;
  /** Adds the shared per-user daily model budget on top of `rateLimit`. */
  modelBudget?: boolean;
}

/**
 * Builds a route handler with identity, validation, limits and safe error
 * mapping already applied. A handler returning a plain value has it sent as
 * JSON; returning a Response passes it through untouched.
 */
export function defineRoute<TBody = undefined>(
  config: RouteConfig<TBody>,
  handler: (ctx: RouteContext<TBody>) => Promise<unknown>
): (req: NextRequest) => Promise<Response> {
  const requireAuth = config.requireAuth ?? true;
  return async function route(req: NextRequest): Promise<Response> {
    const requestId = newRequestId();
    const startedAt = Date.now();
    let userId = 0;
    try {
      if (requireAuth) userId = await requireUserId();

      if (config.rateLimit) {
        const subject = requireAuth ? String(userId) : clientAddress(req);
        enforceRateLimit({ name: config.name, ...config.rateLimit }, subject);
      }
      if (config.modelBudget && requireAuth) enforceModelBudget(userId);

      const body = config.schema
        ? await readValidatedBody(req, config.schema, config.maxBytes)
        : (undefined as TBody);

      const result = await handler({ req, body, userId, requestId });
      if (result instanceof Response) return result;
      return jsonResponse(result ?? { ok: true });
    } catch (err) {
      return toSafeErrorResponse(err, requestId);
    } finally {
      // Structured, and deliberately free of learner content: route, outcome
      // timing and the correlation id only.
      console.info(
        `[api] route=${config.name} requestId=${requestId} user=${userId || "anon"} ms=${Date.now() - startedAt}`
      );
    }
  };
}
