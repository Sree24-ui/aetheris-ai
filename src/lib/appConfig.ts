// Single source of truth for app-level identity, limits and tunables, so
// values can't drift between the files that use them.
//
// IMPORTANT — server vs client:
// Next.js inlines `process.env.X` at build time and, for anything without the
// NEXT_PUBLIC_ prefix, substitutes `undefined` in the browser bundle. So a
// value read here and consumed by a client component MUST use NEXT_PUBLIC_,
// otherwise the env var silently does nothing and the fallback always wins.
// The two groups are kept separate below for exactly that reason.

export const APP_NAME = "Aetheris AI";

export const APP_DESCRIPTION = "A human-like AI educator that teaches through video";

// Public base URL of the deployment. NEXT_PUBLIC_SITE_URL wins (custom
// domain), then Vercel's own auto-populated production URL, then localhost
// for development. Server-only vars simply resolve to undefined on the
// client, where the public var (or the localhost fallback) applies.
export const APP_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

// Numeric environment parsing.
//
// A single "positive number" parser was doing all of this, which let three
// distinct classes of bad configuration through: a fractional value where an
// integer is required (EMBED_BATCH_SIZE=1.5), a value with no upper bound
// (TOKENS_LESSON_PLAN=10000000, one request that spends a month of quota),
// and a legitimate zero being rejected (MODEL_TEMPERATURE=0 is the correct
// setting for deterministic output, and was silently replaced by 0.7).
//
// Each parser below states its own domain, and an out-of-domain value falls
// back to the documented default rather than being used.

function parseNumber(
  raw: string | undefined,
  fallback: number,
  opts: { min: number; max: number; integer?: boolean }
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  if (opts.integer && !Number.isInteger(parsed)) return fallback;
  if (parsed < opts.min || parsed > opts.max) return fallback;
  return parsed;
}

/** A count: whole number, at least 1, with an explicit ceiling. */
function count(raw: string | undefined, fallback: number, max: number): number {
  return parseNumber(raw, fallback, { min: 1, max, integer: true });
}

/** A duration in milliseconds: whole, at least 1ms, at most an hour. */
function duration(raw: string | undefined, fallback: number, max = 3_600_000): number {
  return parseNumber(raw, fallback, { min: 1, max, integer: true });
}

/** A ratio in [0, 2] — temperature and similar, where 0 is meaningful. */
function ratio(raw: string | undefined, fallback: number, max = 2): number {
  return parseNumber(raw, fallback, { min: 0, max });
}

/** Backwards-compatible alias used by the client-visible block below. */
const num = (raw: string | undefined, fallback: number) =>
  parseNumber(raw, fallback, { min: 1, max: Number.MAX_SAFE_INTEGER });

// =========================================================================
// CLIENT-VISIBLE — every one of these is read in a browser bundle, so each
// must be referenced as a full literal `process.env.NEXT_PUBLIC_*` expression
// for Next's build-time substitution to find it. Do not refactor these into a
// dynamic lookup; `process.env[name]` is not substituted and would break them.
// =========================================================================

/** Minimum password length, shared by the signup form and register route. */
export const MIN_PASSWORD_LENGTH = num(process.env.NEXT_PUBLIC_MIN_PASSWORD_LENGTH, 8);

/**
 * Concurrent section translations when the learner switches language.
 * Firing all of them at once trips per-minute request limits, which is what
 * turned a language switch into a wall of failures.
 */
export const TRANSLATE_CONCURRENCY = num(process.env.NEXT_PUBLIC_TRANSLATE_CONCURRENCY, 3);

/** Avatar mouth-flap interval in ms while narration plays. */
export const MOUTH_FLAP_MS = num(process.env.NEXT_PUBLIC_MOUTH_FLAP_MS, 130);

/** How long the avatar's eyes stay shut for one blink, in ms. */
export const BLINK_DURATION_MS = num(process.env.NEXT_PUBLIC_BLINK_DURATION_MS, 140);

/** How long the celebration confetti stays on the report screen, in ms. */
export const CONFETTI_DURATION_MS = num(process.env.NEXT_PUBLIC_CONFETTI_DURATION_MS, 5000);

// Narration watchdog. Some browsers never fire onend/onerror for speech
// synthesis, so the lesson needs an upper bound on how long it will wait.
/** Rough milliseconds of speech per character, before rate scaling. */
export const SPEECH_MS_PER_CHAR = num(process.env.NEXT_PUBLIC_SPEECH_MS_PER_CHAR, 90);
/** Floor and ceiling on that estimate. */
export const SPEECH_WATCHDOG_MIN_MS = num(process.env.NEXT_PUBLIC_SPEECH_WATCHDOG_MIN_MS, 4000);
export const SPEECH_WATCHDOG_MAX_MS = num(process.env.NEXT_PUBLIC_SPEECH_WATCHDOG_MAX_MS, 60_000);
/** Fresh window granted after resuming a paused utterance. */
export const SPEECH_RESUME_WATCHDOG_MS = num(process.env.NEXT_PUBLIC_SPEECH_RESUME_WATCHDOG_MS, 20_000);

// =========================================================================
// SERVER-ONLY — read inside route handlers and lib code that never ships to
// the browser.
// =========================================================================

/**
 * Per-call model output budgets.
 *
 * These were literals scattered across teachingAgent.ts, where the only way to
 * discover the cost of a lesson was to read every call site. Collected here so
 * the expensive knobs are visible in one place and tunable per deployment —
 * which matters a lot when a provider's free tier is measured in tokens.
 */
/** Hard ceiling on any single call's output budget, whatever the env says. */
export const MAX_OUTPUT_TOKENS = 32_768;

export const TOKEN_BUDGET = {
  concepts: count(process.env.TOKENS_CONCEPTS, 300, MAX_OUTPUT_TOKENS),
  instruction: count(process.env.TOKENS_INSTRUCTION, 512, MAX_OUTPUT_TOKENS),
  lessonPlan: count(process.env.TOKENS_LESSON_PLAN, 8192, MAX_OUTPUT_TOKENS),
  evaluation: count(process.env.TOKENS_EVALUATION, 1536, MAX_OUTPUT_TOKENS),
  quiz: count(process.env.TOKENS_QUIZ, 4096, MAX_OUTPUT_TOKENS),
  report: count(process.env.TOKENS_REPORT, 1024, MAX_OUTPUT_TOKENS),
  translation: count(process.env.TOKENS_TRANSLATION, 2048, MAX_OUTPUT_TOKENS),
  learningPath: count(process.env.TOKENS_LEARNING_PATH, 2048, MAX_OUTPUT_TOKENS),
  chat: count(process.env.TOKENS_CHAT, 1024, MAX_OUTPUT_TOKENS),
} as const;

/** Sampling temperature. 0 is valid and means "deterministic". */
export const MODEL_TEMPERATURE = ratio(process.env.MODEL_TEMPERATURE, 0.7);

/** Base delay for exponential backoff between retries, in ms. */
export const RETRY_BASE_DELAY_MS = duration(process.env.LLM_RETRY_BASE_DELAY_MS, 1000, 60_000);

/** How long to wait on a single model request before aborting and retrying. */
export const REQUEST_TIMEOUT_MS = duration(
  process.env.LLM_TIMEOUT_MS ?? process.env.GEMINI_TIMEOUT_MS,
  30_000,
  120_000
);

/**
 * End-to-end budget for one model-backed operation, covering every attempt,
 * backoff and output-repair round.
 *
 * M8: three 30s attempts plus backoff could exceed the route's own 60s
 * ceiling, so the platform killed the function before the response was ever
 * serialised — the learner saw a hang, and the logs held nothing. Retries now
 * stop when this deadline is reached, leaving room to send a real answer.
 */
export const TOTAL_DEADLINE_MS = duration(process.env.LLM_TOTAL_DEADLINE_MS, 50_000, 300_000);

/** Attempts spent asking the model to correct structurally invalid output. */
export const MAX_REPAIR_ATTEMPTS = parseNumber(process.env.LLM_MAX_REPAIR_ATTEMPTS, 1, {
  min: 0,
  max: 3,
  integer: true,
});

/** Total attempts per call, covering transient 429/5xx and timeouts. */
export const MAX_ATTEMPTS = count(
  process.env.LLM_MAX_ATTEMPTS ?? process.env.GEMINI_MAX_ATTEMPTS,
  3,
  10
);

/**
 * Wait used when a provider rate-limits us without saying for how long.
 * Providers that send Retry-After / RetryInfo always take precedence.
 */
export const RATE_LIMIT_FALLBACK_MS = duration(process.env.LLM_RATE_LIMIT_FALLBACK_MS, 5000, 300_000);
/** Same, for a 5xx where the provider gave no hint. */
export const SERVER_ERROR_FALLBACK_MS = duration(process.env.LLM_SERVER_ERROR_FALLBACK_MS, 2000, 300_000);

// --- Retrieval and ingestion --------------------------------------------
/** Chunks pulled from an uploaded document to ground a lesson. */
export const RETRIEVAL_TOP_K = count(process.env.RETRIEVAL_TOP_K, 10, 100);
/** Target characters per chunk, and the overlap carried between them. */
export const CHUNK_MAX_CHARS = count(process.env.CHUNK_MAX_CHARS, 900, 20_000);
/**
 * Overlap must stay below the chunk size, or the sliding window stops
 * advancing and the chunk loop never terminates. An out-of-range value falls
 * back to a sixth of the chunk size rather than being trusted.
 */
export const CHUNK_OVERLAP = (() => {
  const requested = parseNumber(process.env.CHUNK_OVERLAP, 150, {
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    integer: true,
  });
  return requested < CHUNK_MAX_CHARS ? requested : Math.floor(CHUNK_MAX_CHARS / 6);
})();
/** Chunks shorter than this are dropped as noise (page numbers, stray glyphs). */
export const CHUNK_MIN_CHARS = parseNumber(process.env.CHUNK_MIN_CHARS, 20, { min: 0, max: 1000, integer: true });
/** Texts embedded per batch; larger batches trade memory for fewer passes. */
export const EMBED_BATCH_SIZE = count(process.env.EMBED_BATCH_SIZE, 16, 256);
/** An upload yielding less readable text than this is rejected as unparseable. */
export const MIN_EXTRACTED_CHARS = count(process.env.MIN_EXTRACTED_CHARS, 20, 100_000);
/** Characters of the document shown back to the learner as a preview. */
export const DOCUMENT_PREVIEW_CHARS = count(process.env.DOCUMENT_PREVIEW_CHARS, 400, 10_000);
/** Leading chunks, and characters, sampled for concept extraction. */
export const CONCEPT_SAMPLE_CHUNKS = count(process.env.CONCEPT_SAMPLE_CHUNKS, 5, 200);
export const CONCEPT_SAMPLE_CHARS = count(process.env.CONCEPT_SAMPLE_CHARS, 4000, 100_000);
/** Maximum concept tags kept from an extraction. */
export const MAX_CONCEPT_TAGS = count(process.env.MAX_CONCEPT_TAGS, 6, 50);

// --- Conversation and history -------------------------------------------
/** Prior chat turns sent as context; caps prompt growth over a long lesson. */
export const CHAT_HISTORY_TURNS = count(process.env.CHAT_HISTORY_TURNS, 6, 100);
/** Follow-up suggestions surfaced after an answer. */
export const MAX_FOLLOW_UPS = count(process.env.MAX_FOLLOW_UPS, 2, 10);
/** Lesson history rows loaded per learner. */
export const HISTORY_PAGE_SIZE = count(process.env.HISTORY_PAGE_SIZE, 50, 500);

// --- Uploads -------------------------------------------------------------
/**
 * The formats the parser actually implements. Shared with the file picker so
 * the two cannot drift — previously the accept list and the parser's switch
 * were maintained separately, and adding a format to one without the other
 * either hid a working parser or offered a format that always failed.
 */
export const SUPPORTED_DOCUMENT_EXTENSIONS = ["pdf", "docx", "pptx", "txt", "md"] as const;
export type SupportedDocumentExtension = (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number];

/** The `accept` attribute for a file input, derived from the list above. */
export const DOCUMENT_ACCEPT_ATTRIBUTE = SUPPORTED_DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(",");
