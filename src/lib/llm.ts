import { APP_NAME } from "./appConfig";
import { LlmError, classifyGoogleError } from "./llmError";

// Google Gen AI (Gemini) REST integration.
//
// Uses the generateContent REST endpoint rather than the @google/genai SDK:
// it needs no extra dependency, matches the fetch style used elsewhere in the
// project, and keeps the serverless bundle small (this app already had to work
// around native-module bundling for onnxruntime).
const GEMINI_BASE_URL =
  process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";

const MODEL_ID = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// How long to wait on a single request before aborting and retrying.
const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 30_000;

// Total attempts per call, covering transient 429/5xx and timeouts.
const MAX_ATTEMPTS = Number(process.env.GEMINI_MAX_ATTEMPTS) || 3;

// Gemini 2.5 models reason with internal "thinking" tokens that are billed
// against maxOutputTokens. Left on, a small budget (the concept-extraction
// call asks for only 300) can be consumed entirely by thinking, returning an
// empty candidate with finishReason MAX_TOKENS and no usable JSON. Thinking is
// disabled by default so the existing per-call budgets behave predictably;
// set GEMINI_THINKING_BUDGET to re-enable it (-1 lets the model decide).
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);

function getApiKey(): string {
  const raw = process.env.GEMINI_API_KEY;
  if (!raw || !raw.trim()) {
    throw new LlmError({
      kind: "auth",
      message: "GEMINI_API_KEY is not set",
      userMessage: `GEMINI_API_KEY is not set. Add it to .env.local to enable ${APP_NAME}.`,
      httpStatus: 401,
    });
  }

  // Keys pasted from a browser or chat client often arrive wrapped in quotes
  // — sometimes curly ones — or with stray whitespace. Trim what we safely
  // can, then reject anything still unusable as a header value with a message
  // that names the problem, instead of letting fetch throw an opaque
  // "Cannot convert argument to a ByteString" from deep inside undici.
  const apiKey = raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();

  if (!apiKey) {
    throw new LlmError({
      kind: "auth",
      message: "GEMINI_API_KEY contained only quotes",
      userMessage: "GEMINI_API_KEY appears to contain only quotes. Check the value in .env.local.",
      httpStatus: 401,
    });
  }
  // HTTP header values must be Latin-1; smart quotes and other non-ASCII
  // characters are a reliable sign of a mangled copy-paste.
  const badChar = [...apiKey].find((ch) => ch.charCodeAt(0) > 127 || ch.charCodeAt(0) < 32);
  if (badChar) {
    throw new LlmError({
      kind: "auth",
      message: "GEMINI_API_KEY contains a non-Latin-1 character",
      userMessage:
        `GEMINI_API_KEY contains an invalid character (U+${badChar
          .charCodeAt(0)
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")}). It was probably pasted with smart quotes or a line break — ` +
        `re-copy the key as plain text into .env.local.`,
      httpStatus: 401,
    });
  }
  return apiKey;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Salvages a JSON payload from a response that arrived wrapped in prose or a
 * markdown fence. With responseMimeType: "application/json" the model should
 * already return bare JSON, so this is only a fallback for the text path and
 * for any response that slips through in the older shape.
 */
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const objStart = candidate.indexOf("{");
  const arrStart = candidate.indexOf("[");
  let from = objStart;
  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) from = arrStart;
  if (from === -1) return candidate.trim();
  const to = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  return candidate.slice(from, to + 1).trim();
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

interface GenerateOptions {
  system: string;
  user: string;
  maxOutputTokens: number;
  /** "application/json" asks Gemini for a strict, parseable JSON body. */
  responseMimeType: "application/json" | "text/plain";
}

async function generateContent({
  system,
  user,
  maxOutputTokens,
  responseMimeType,
}: GenerateOptions): Promise<string> {
  const apiKey = getApiKey();
  const url = `${GEMINI_BASE_URL}/models/${MODEL_ID}:generateContent`;

  const body = {
    // Gemini takes the system prompt as its own field rather than as a
    // pseudo-message in the conversation.
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens,
      responseMimeType,
      temperature: 0.7,
      ...(THINKING_BUDGET >= 0 ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET } } : {}),
    },
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          // Sent as a header, never as a query parameter — a key in the URL
          // leaks into logs, proxies and error traces.
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text();
        const classified = classifyGoogleError(res.status, detail);
        // Only genuinely transient failures are worth another attempt. An
        // exhausted quota, a rejected key or an unknown model fails identically
        // every time, so retrying them only adds seconds of dead air before the
        // same error reaches the learner — which is what made the UI look
        // frozen and the buttons look broken.
        if (!classified.retryable || attempt >= MAX_ATTEMPTS - 1) throw classified;
        lastError = classified;
        // Prefer the server's own RetryInfo delay over our guess when it sends
        // one, so we come back exactly when it is willing to serve us again.
        await sleep(classified.retryAfterMs ?? 1000 * 2 ** attempt);
        continue;
      }

      const data = (await res.json()) as GeminiResponse;

      const candidate = data.candidates?.[0];
      if (!candidate) {
        const blocked = data.promptFeedback?.blockReason;
        throw new LlmError({
          kind: "blocked",
          message: blocked
            ? `Gemini returned no content (blocked: ${blocked})`
            : "Gemini returned no candidates",
          userMessage: blocked
            ? "The AI declined to answer this request (its safety filters blocked it). Try rephrasing the topic."
            : "The AI returned an empty response. Try again, or rephrase the topic.",
          httpStatus: 502,
        });
      }

      // Concatenate only the answer parts; when thinking is enabled the model
      // also returns parts flagged `thought`, which are not part of the answer.
      const text = (candidate.content?.parts ?? [])
        .filter((p) => p.thought !== true && typeof p.text === "string")
        .map((p) => p.text)
        .join("")
        .trim();

      if (!text) {
        if (candidate.finishReason === "MAX_TOKENS") {
          throw new LlmError({
            kind: "truncated",
            message:
              `Gemini hit the ${maxOutputTokens}-token output limit before producing any text. ` +
              `Raise the limit for this call, or set GEMINI_THINKING_BUDGET=0 if thinking is enabled.`,
            userMessage:
              "The AI ran out of output budget before writing anything. If this keeps happening, set GEMINI_THINKING_BUDGET=0 in .env.local.",
            httpStatus: 502,
          });
        }
        throw new LlmError({
          kind: "blocked",
          message: `Gemini returned an empty response (finishReason: ${candidate.finishReason ?? "unknown"})`,
          userMessage: "The AI returned an empty response. Try again, or rephrase the topic.",
          httpStatus: 502,
        });
      }

      // A truncated response is almost always unparseable JSON; say so plainly
      // rather than letting it fail later as a confusing parse error.
      if (candidate.finishReason === "MAX_TOKENS" && responseMimeType === "application/json") {
        throw new LlmError({
          kind: "truncated",
          message: `Gemini response was truncated at the ${maxOutputTokens}-token limit, so the JSON is incomplete`,
          userMessage:
            "The AI's answer was cut off before it finished. Try a shorter lesson (less time available) or a narrower topic.",
          httpStatus: 502,
        });
      }

      return text;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        lastError = new LlmError({
          kind: "timeout",
          message: `Timed out waiting for ${MODEL_ID} after ${REQUEST_TIMEOUT_MS}ms`,
          userMessage:
            "The AI took too long to respond. Try again, or pick a shorter session length.",
          retryable: true,
          httpStatus: 504,
        });
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        break;
      }
      // A fetch that rejects without an HTTP status never reached Google —
      // DNS, TLS or offline. Worth one retry, but say plainly that it is a
      // connectivity problem rather than an AI one.
      if (!(err instanceof LlmError) && err instanceof TypeError) {
        lastError = new LlmError({
          kind: "network",
          message: `Could not reach the Gemini API: ${err.message}`,
          userMessage: "Could not reach the AI service. Check your internet connection and try again.",
          retryable: true,
          httpStatus: 503,
        });
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        break;
      }
      // Non-transient failures (bad key, blocked prompt, empty candidate)
      // won't change on retry.
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError ||
    new LlmError({
      kind: "unknown",
      message: `All ${MAX_ATTEMPTS} attempts to reach ${MODEL_ID} failed`,
      userMessage: "Could not reach the AI service after several attempts. Try again in a moment.",
      retryable: true,
      httpStatus: 503,
    })
  );
}

/**
 * Runs a prompt and parses the reply as JSON of type T. Asks Gemini for
 * `application/json` so the model emits a strict JSON body directly instead of
 * prose or a fenced code block that has to be scraped.
 */
export async function callModelJSON<T>(
  system: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<T> {
  const raw = await generateContent({
    system,
    user: userPrompt,
    maxOutputTokens: maxTokens,
    responseMimeType: "application/json",
  });

  try {
    return JSON.parse(raw) as T;
  } catch {
    // Structured output should make this unnecessary, but retry through the
    // salvage path before failing so a stray fence doesn't sink the lesson.
    try {
      return JSON.parse(extractJson(raw)) as T;
    } catch (err) {
      throw new LlmError({
        kind: "parse",
        message: `Failed to parse JSON from ${MODEL_ID} response: ${(err as Error).message}\nRaw: ${raw.slice(0, 500)}`,
        userMessage: "The AI's answer came back in an unexpected format. Try again.",
        retryable: true,
        httpStatus: 502,
      });
    }
  }
}

export async function callModelText(
  system: string,
  userPrompt: string,
  maxTokens = 1024
): Promise<string> {
  return generateContent({
    system,
    user: userPrompt,
    maxOutputTokens: maxTokens,
    responseMimeType: "text/plain",
  });
}

export const MODEL = MODEL_ID;
