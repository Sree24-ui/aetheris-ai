"use client";

/**
 * The browser's one way of talking to this app's API (H7).
 *
 * `src/lib/memory.ts` used to `await fetch(...)` and never look at the result.
 * A 401 from an expired session, a 429, a 500 or a dropped connection all
 * looked exactly like success, so the UI told a learner their lesson was
 * saved when nothing had been written. Every call now goes through
 * `apiRequest`, which either returns a parsed body or throws a `RequestFailed`
 * carrying a sentence fit to show, whether a retry is worth offering, and the
 * request id the server logged the failure under.
 */

/** The error envelope every route returns (see src/lib/security/http.ts). */
interface ApiErrorBody {
  error?: unknown;
  kind?: unknown;
  retryable?: unknown;
  retryAfterMs?: unknown;
  requestId?: unknown;
}

export class RequestFailed extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;
  readonly kind: string;
  /** Whether repeating the same request could plausibly succeed. */
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  /** Correlates with the server log line, when the server got far enough. */
  readonly requestId?: string;

  constructor(params: {
    status: number;
    kind: string;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    requestId?: string;
  }) {
    super(params.message);
    this.name = "RequestFailed";
    this.status = params.status;
    this.kind = params.kind;
    this.retryable = params.retryable;
    this.retryAfterMs = params.retryAfterMs;
    this.requestId = params.requestId;
  }
}

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;

/** A sentence for a status the server did not describe itself. */
function fallbackMessage(status: number): string {
  if (status === 401) return "Your session has expired. Sign in again to continue.";
  if (status === 403) return "You do not have access to that.";
  if (status === 404) return "That could not be found.";
  if (status === 409) return "That conflicts with a change made somewhere else. Reload and try again.";
  if (status === 413) return "That was too large to send.";
  if (status === 429) return "You have made too many requests. Wait a moment and try again.";
  if (status >= 500) return "The server had a problem. Try again in a moment.";
  return "That request could not be completed.";
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Serialised as JSON. Omit for a request with no body. */
  body?: unknown;
  /** Lets a caller cancel when the user navigates away. */
  signal?: AbortSignal;
}

/**
 * Sends a request and returns its parsed body, or throws `RequestFailed`.
 *
 * An `AbortError` is re-thrown untouched: a cancelled request is not a
 * failure to report, and a caller that aborted already knows.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new RequestFailed({
      status: 0,
      kind: "network",
      message: "Could not reach the server. Check your connection and try again.",
      retryable: true,
    });
  }

  // A body is read once, as text, because an error response may not be JSON
  // at all (a platform-level 502 is usually HTML).
  const raw = await response.text().catch(() => "");
  let parsed: unknown;
  try {
    parsed = raw === "" ? undefined : JSON.parse(raw);
  } catch {
    parsed = undefined;
  }

  if (!response.ok) {
    const envelope = (parsed ?? {}) as ApiErrorBody;
    const retryAfterHeader = Number(response.headers.get("Retry-After"));
    throw new RequestFailed({
      status: response.status,
      kind: asString(envelope.kind) ?? "unknown",
      message: asString(envelope.error) ?? fallbackMessage(response.status),
      retryable:
        typeof envelope.retryable === "boolean"
          ? envelope.retryable
          : response.status === 429 || response.status >= 500,
      retryAfterMs:
        typeof envelope.retryAfterMs === "number"
          ? envelope.retryAfterMs
          : Number.isFinite(retryAfterHeader)
            ? retryAfterHeader * 1000
            : undefined,
      requestId: asString(envelope.requestId),
    });
  }

  return parsed as T;
}

/** True when the failure means the learner needs to sign in again. */
export function isSessionExpired(err: unknown): boolean {
  return err instanceof RequestFailed && err.status === 401;
}

/** A message for a caught error, whatever kind it turned out to be. */
export function errorMessage(err: unknown): string {
  if (err instanceof RequestFailed) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}
