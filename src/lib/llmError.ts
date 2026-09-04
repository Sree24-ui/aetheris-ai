/**
 * Typed errors for the Gemini integration.
 *
 * The API returns very different problems under similar-looking HTTP codes —
 * a 429 can mean "you sent two requests too close together" (worth retrying
 * in a second) or "your daily free-tier quota is gone" (retrying just burns
 * time and makes the app feel frozen). Callers and the UI need to tell those
 * apart, so failures carry a `kind` plus a sentence fit to show a learner
 * instead of a raw JSON blob.
 */
import { RATE_LIMIT_FALLBACK_MS, SERVER_ERROR_FALLBACK_MS } from "./appConfig";

export type LlmErrorKind =
  | "quota"      // billing//quota exhausted — retrying will not help
  | "rateLimit"  // too many requests per minute — retrying will help
  | "auth"       // missing/invalid/rejected API key
  | "model"      // model id unknown or not available to this key
  | "blocked"    // safety filters refused the prompt or response
  | "timeout"    // no response within the per-request budget
  | "truncated"  // hit maxOutputTokens before finishing
  | "parse"      // response was not the JSON we asked for
  | "network"    // could not reach the API at all
  | "unknown";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  /** Safe to render directly in the UI. */
  readonly userMessage: string;
  /** Whether a retry has any chance of succeeding. */
  readonly retryable: boolean;
  /** Suggested wait before retrying, when the API told us one. */
  readonly retryAfterMs?: number;
  /** HTTP status to surface from an API route. */
  readonly httpStatus: number;

  constructor(params: {
    kind: LlmErrorKind;
    message: string;
    userMessage: string;
    retryable?: boolean;
    retryAfterMs?: number;
    httpStatus?: number;
  }) {
    super(params.message);
    this.name = "LlmError";
    this.kind = params.kind;
    this.userMessage = params.userMessage;
    this.retryable = params.retryable ?? false;
    this.retryAfterMs = params.retryAfterMs;
    this.httpStatus = params.httpStatus ?? 502;
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: { "@type"?: string; retryDelay?: string; [k: string]: unknown }[];
  };
}

/** Pulls the `retryDelay: "17s"` that Google attaches to RetryInfo details. */
function retryDelayFromDetails(body: GoogleErrorBody): number | undefined {
  const details = body.error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const d of details) {
    const delay = typeof d?.retryDelay === "string" ? d.retryDelay : undefined;
    if (!delay) continue;
    const seconds = Number(delay.replace(/s$/, ""));
    if (Number.isFinite(seconds)) return Math.round(seconds * 1000);
  }
  return undefined;
}

/**
 * Turns a non-OK Gemini response into a typed error. `raw` is the response
 * body, which is usually JSON but is occasionally empty or an HTML error page,
 * so every read is defensive.
 */
export function classifyGoogleError(status: number, raw: string): LlmError {
  let body: GoogleErrorBody = {};
  try {
    body = JSON.parse(raw) as GoogleErrorBody;
  } catch {
    // Leave body empty; fall back to status-based classification below.
  }
  const apiMessage = body.error?.message?.trim();
  const apiStatus = body.error?.status;
  const retryAfterMs = retryDelayFromDetails(body);
  // Keep the upstream text in `message` for logs, but never as userMessage.
  const detail = apiMessage ? `: ${apiMessage}` : raw ? `: ${raw.slice(0, 200)}` : "";

  if (status === 429) {
    // Both arrive as 429 + RESOURCE_EXHAUSTED. The distinguishing signal is
    // the message text: a per-minute limit mentions rate, a plan limit talks
    // about quota/billing. Default to treating it as a hard quota stop —
    // retrying a genuinely exhausted quota is what makes the UI hang.
    const looksLikeRate =
      !!apiMessage && /per minute|rate limit|too many requests|requests per/i.test(apiMessage);
    if (looksLikeRate) {
      return new LlmError({
        kind: "rateLimit",
        message: `Gemini rate limited (429)${detail}`,
        userMessage:
          "Too many requests in a short window. Waiting a few seconds and trying again usually clears this.",
        retryable: true,
        retryAfterMs: retryAfterMs ?? RATE_LIMIT_FALLBACK_MS,
        httpStatus: 429,
      });
    }
    return new LlmError({
      kind: "quota",
      message: `Gemini quota exhausted (429)${detail}`,
      userMessage:
        "Your Gemini API quota is used up. This is an account limit, not a bug in the app — " +
        "enable billing or wait for the quota to reset at https://ai.dev/rate-limit, then try again.",
      retryable: false,
      retryAfterMs,
      httpStatus: 429,
    });
  }

  if (status === 401 || status === 403) {
    return new LlmError({
      kind: "auth",
      message: `Gemini rejected the API key (${status})${detail}`,
      userMessage:
        "The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local — it may be missing, " +
        "revoked, or restricted to different APIs.",
      retryable: false,
      httpStatus: 401,
    });
  }

  if (status === 404) {
    return new LlmError({
      kind: "model",
      message: `Gemini model unavailable (404)${detail}`,
      userMessage: apiMessage
        ? `The configured model is unavailable. ${apiMessage}`
        : "The configured Gemini model is not available to this API key. Set GEMINI_MODEL in .env.local to a model your key can use.",
      retryable: false,
      httpStatus: 404,
    });
  }

  if (status === 400 && /API key not valid/i.test(apiMessage ?? "")) {
    return new LlmError({
      kind: "auth",
      message: `Gemini rejected the API key (400)${detail}`,
      userMessage: "The Gemini API key is not valid. Check GEMINI_API_KEY in .env.local.",
      retryable: false,
      httpStatus: 401,
    });
  }

  if (status >= 500) {
    return new LlmError({
      kind: "unknown",
      message: `Gemini server error (${status})${detail}`,
      userMessage: "Google's API is having trouble right now. Try again in a moment.",
      retryable: true,
      retryAfterMs: retryAfterMs ?? SERVER_ERROR_FALLBACK_MS,
      httpStatus: 503,
    });
  }

  return new LlmError({
    kind: "unknown",
    message: `Gemini request failed (${status}${apiStatus ? ` ${apiStatus}` : ""})${detail}`,
    userMessage: apiMessage
      ? `The AI service rejected the request: ${apiMessage}`
      : "The AI service rejected the request.",
    retryable: false,
    httpStatus: 502,
  });
}

interface OpenAIErrorBody {
  error?: { message?: string; type?: string; code?: string };
}

/**
 * Classifies a failure from an OpenAI-compatible backend (Groq).
 *
 * The shape differs from Google's: one `error.message`, no RetryInfo details,
 * and the wait time arrives in the standard `Retry-After` header instead.
 */
export function classifyOpenAIError(
  status: number,
  raw: string,
  retryAfterHeader?: string | null
): LlmError {
  let body: OpenAIErrorBody = {};
  try {
    body = JSON.parse(raw) as OpenAIErrorBody;
  } catch {
    // Fall through to status-based classification.
  }
  const apiMessage = body.error?.message?.trim();
  const detail = apiMessage ? `: ${apiMessage}` : raw ? `: ${raw.slice(0, 200)}` : "";
  const retrySeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  const retryAfterMs = Number.isFinite(retrySeconds) ? retrySeconds * 1000 : undefined;

  if (status === 429) {
    // Groq separates a per-minute throttle (worth waiting out) from a spent
    // daily allowance (not). The message text is the only signal.
    const isDailyCap = !!apiMessage && /per day|daily|quota/i.test(apiMessage);
    if (isDailyCap) {
      return new LlmError({
        kind: "quota",
        message: `Groq daily quota exhausted (429)${detail}`,
        userMessage:
          "The daily request allowance for this API key is used up. It resets on a 24-hour cycle, or you can raise the limit on your account.",
        retryable: false,
        retryAfterMs,
        httpStatus: 429,
      });
    }
    return new LlmError({
      kind: "rateLimit",
      message: `Groq rate limited (429)${detail}`,
      userMessage:
        "Too many requests in a short window. Waiting a few seconds and trying again usually clears this.",
      retryable: true,
      retryAfterMs: retryAfterMs ?? RATE_LIMIT_FALLBACK_MS,
      httpStatus: 429,
    });
  }

  if (status === 401 || status === 403) {
    return new LlmError({
      kind: "auth",
      message: `Groq rejected the API key (${status})${detail}`,
      userMessage: "The Groq API key was rejected. Check GROQ_API_KEY in .env.local.",
      retryable: false,
      httpStatus: 401,
    });
  }

  if (status === 404) {
    return new LlmError({
      kind: "model",
      message: `Groq model unavailable (404)${detail}`,
      userMessage:
        "The configured Groq model is not available to this key. Set GROQ_MODEL in .env.local to a model your account can use.",
      retryable: false,
      httpStatus: 404,
    });
  }

  if (status >= 500 || status === 503) {
    return new LlmError({
      kind: "unknown",
      message: `Groq server error (${status})${detail}`,
      userMessage: "The AI service is having trouble right now. Try again in a moment.",
      retryable: true,
      retryAfterMs: retryAfterMs ?? SERVER_ERROR_FALLBACK_MS,
      httpStatus: 503,
    });
  }

  return new LlmError({
    kind: "unknown",
    message: `Groq request failed (${status})${detail}`,
    userMessage: apiMessage
      ? `The AI service rejected the request: ${apiMessage}`
      : "The AI service rejected the request.",
    retryable: false,
    httpStatus: 502,
  });
}

/**
 * Normalises anything thrown inside a route into the shape the client renders.
 * Non-LlmError throws (bugs, DB failures) keep a generic message rather than
 * leaking internals into the UI.
 */
export function toErrorResponse(err: unknown): {
  body: { error: string; kind: LlmErrorKind; retryable: boolean; retryAfterMs?: number };
  status: number;
} {
  if (err instanceof LlmError) {
    return {
      body: {
        error: err.userMessage,
        kind: err.kind,
        retryable: err.retryable,
        retryAfterMs: err.retryAfterMs,
      },
      status: err.httpStatus,
    };
  }
  // Anything that is not a typed LlmError is a bug, a driver failure or a
  // database error. Its message can name tables, file paths or connection
  // details, so it is logged and replaced rather than returned. This used to
  // pass `err.message` straight through to the browser.
  console.error("[llm] unhandled error", err);
  return {
    body: {
      error: "Something went wrong on our side. Try again in a moment.",
      kind: "unknown",
      retryable: true,
    },
    status: 500,
  };
}
