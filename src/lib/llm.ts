import { APP_NAME } from "./appConfig";

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
    throw new Error(
      `GEMINI_API_KEY is not set. Add it to .env.local to enable ${APP_NAME}.`
    );
  }

  // Keys pasted from a browser or chat client often arrive wrapped in quotes
  // — sometimes curly ones — or with stray whitespace. Trim what we safely
  // can, then reject anything still unusable as a header value with a message
  // that names the problem, instead of letting fetch throw an opaque
  // "Cannot convert argument to a ByteString" from deep inside undici.
  const apiKey = raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();

  if (!apiKey) {
    throw new Error(`GEMINI_API_KEY appears to contain only quotes. Check the value in .env.local.`);
  }
  // HTTP header values must be Latin-1; smart quotes and other non-ASCII
  // characters are a reliable sign of a mangled copy-paste.
  const badChar = [...apiKey].find((ch) => ch.charCodeAt(0) > 127 || ch.charCodeAt(0) < 32);
  if (badChar) {
    throw new Error(
      `GEMINI_API_KEY contains an invalid character (U+${badChar
        .charCodeAt(0)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")}). It was probably pasted with smart quotes or a line break — ` +
        `re-copy the key as plain text into .env.local.`
    );
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

      // 429 (rate limit) and 5xx are transient: back off and retry. Everything
      // else (401/403 bad key, 400 bad request) will fail identically on a
      // retry, so surface it immediately.
      if (res.status === 429 || res.status >= 500) {
        const detail = await res.text();
        lastError = new Error(
          `Gemini transient error (${res.status}): ${detail.slice(0, 300)}`
        );
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        break;
      }

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Gemini request failed (${res.status}): ${detail.slice(0, 300)}`);
      }

      const data = (await res.json()) as GeminiResponse;

      const candidate = data.candidates?.[0];
      if (!candidate) {
        const blocked = data.promptFeedback?.blockReason;
        throw new Error(
          blocked
            ? `Gemini returned no content (blocked: ${blocked}).`
            : "Gemini returned no candidates."
        );
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
          throw new Error(
            `Gemini hit the ${maxOutputTokens}-token output limit before producing any text. ` +
              `Raise the limit for this call, or set GEMINI_THINKING_BUDGET=0 if thinking is enabled.`
          );
        }
        throw new Error(
          `Gemini returned an empty response (finishReason: ${candidate.finishReason ?? "unknown"}).`
        );
      }

      // A truncated response is almost always unparseable JSON; say so plainly
      // rather than letting it fail later as a confusing parse error.
      if (candidate.finishReason === "MAX_TOKENS" && responseMimeType === "application/json") {
        throw new Error(
          `Gemini response was truncated at the ${maxOutputTokens}-token limit, so the JSON is incomplete.`
        );
      }

      return text;
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        lastError = new Error(`Timed out waiting for ${MODEL_ID} after ${REQUEST_TIMEOUT_MS}ms`);
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

  throw lastError || new Error(`All ${MAX_ATTEMPTS} attempts to reach ${MODEL_ID} failed`);
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
      throw new Error(
        `Failed to parse JSON from ${MODEL_ID} response: ${(err as Error).message}\nRaw: ${raw.slice(0, 500)}`
      );
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
