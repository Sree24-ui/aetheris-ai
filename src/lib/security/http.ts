import type { ZodType } from "zod";
import { LlmError, type LlmErrorKind } from "../llmError";
import { consume, RATE_LIMITS } from "./rateLimit";

/**
 * Transport-level guards shared by every API route: body size limits, schema
 * validation, rate-limit accounting and safe error mapping.
 *
 * Split out from apiGuard.ts so none of it depends on the auth stack — that
 * keeps these controls unit-testable with a plain `Request`, which is exactly
 * the kind of test the audit found missing. For the same reason this file
 * builds plain web `Response`s rather than `NextResponse`: route handlers
 * accept either, and the web type needs no framework runtime to exercise.
 */

/** Largest JSON body accepted by default. Lesson plans are the big ones. */
export const DEFAULT_MAX_BODY_BYTES = 512 * 1024;

/** An error whose message is safe to show a caller. */
export class ApiError extends Error {
  readonly status: number;
  readonly kind: LlmErrorKind | "validation" | "auth" | "forbidden" | "limit" | "notFound";
  readonly retryAfterSeconds?: number;

  constructor(
    status: number,
    kind: ApiError["kind"],
    message: string,
    retryAfterSeconds?: number
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Correlates a client-visible failure with the server log line for it. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** Best-effort client address, for limiting endpoints that have no session. */
export function clientAddress(req: Pick<Request, "headers" | "text">): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Reads and validates a JSON body, refusing anything oversized before it is
 * parsed. `Content-Length` is checked first so an obviously huge request is
 * rejected without buffering it, and the decoded length is checked again
 * because the header is caller-supplied and may be absent or lying.
 */
export async function readValidatedBody<T>(
  req: Pick<Request, "headers" | "text">,
  schema: ZodType<T>,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES
): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, "limit", "That request is too large.");
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    throw new ApiError(400, "validation", "The request body could not be read.");
  }
  if (raw.length > maxBytes) {
    throw new ApiError(413, "limit", "That request is too large.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "validation", "The request body was not valid JSON.");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    // Field paths are echoed, values are not: a value could be anything the
    // caller sent, and reflecting it invites it back through another sink.
    const fields = result.error.issues
      .slice(0, 5)
      .map((issue) => issue.path.join(".") || "(root)")
      .join(", ");
    throw new ApiError(400, "validation", `The request was not valid. Check: ${fields}`);
  }
  return result.data;
}

export interface RateLimitSpec {
  /** Namespace, so two routes do not share a bucket by accident. */
  name: string;
  limit: number;
  windowMs: number;
}

/** Spends one unit of `spec` for `subject`, or throws a 429. */
export function enforceRateLimit(spec: RateLimitSpec, subject: string): void {
  const result = consume(`${spec.name}:${subject}`, spec.limit, spec.windowMs);
  if (!result.allowed) {
    throw new ApiError(
      429,
      "limit",
      "You have made too many requests. Wait a moment and try again.",
      result.retryAfterSeconds
    );
  }
}

/**
 * The shared daily model budget. Applied on top of each model route's
 * per-minute limit so no combination of endpoints can exceed the day's spend.
 */
export function enforceModelBudget(userId: number): void {
  enforceRateLimit({ name: "model-daily", ...RATE_LIMITS.modelDaily }, String(userId));
}

/** JSON response helper. `undefined` fields are dropped by JSON.stringify. */
export function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export interface ApiErrorBody {
  error: string;
  kind: string;
  retryable: boolean;
  retryAfterMs?: number;
  /** Echoed so a learner can quote it and the log line can be found. */
  requestId: string;
}

/**
 * Turns anything thrown in a route into a response that is safe to send.
 *
 * The previous helper returned `err.message` for any non-LlmError, which put
 * database errors, driver internals and stack-adjacent text in front of the
 * browser. Unrecognised failures now get a fixed sentence; the detail goes to
 * the server log, tied to the same request id the caller is shown.
 */
export function toSafeErrorResponse(err: unknown, requestId: string): Response {
  if (err instanceof ApiError) {
    const headers = err.retryAfterSeconds
      ? { "Retry-After": String(err.retryAfterSeconds) }
      : undefined;
    return jsonResponse(
      {
        error: err.message,
        kind: err.kind,
        retryable: err.status === 429 || err.status >= 500,
        retryAfterMs: err.retryAfterSeconds ? err.retryAfterSeconds * 1000 : undefined,
        requestId,
      },
      err.status,
      headers
    );
  }

  if (err instanceof LlmError) {
    // `userMessage` is written for a learner and never contains provider
    // internals; `message` (which does) stays in the log.
    console.error(`[api ${requestId}] ${err.name}: ${err.message}`);
    return jsonResponse(
      {
        error: err.userMessage,
        kind: err.kind,
        retryable: err.retryable,
        retryAfterMs: err.retryAfterMs,
        requestId,
      },
      err.httpStatus
    );
  }

  console.error(`[api ${requestId}] unhandled error`, err);
  return jsonResponse(
    {
      error: "Something went wrong on our side. Try again in a moment.",
      kind: "unknown",
      retryable: true,
      requestId,
    },
    500
  );
}

