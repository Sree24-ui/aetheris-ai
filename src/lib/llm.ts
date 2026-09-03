import {
  MAX_ATTEMPTS,
  MODEL_TEMPERATURE,
  REQUEST_TIMEOUT_MS,
  RETRY_BASE_DELAY_MS,
} from "./appConfig";
import { LlmError } from "./llmError";
import { createGeminiProvider } from "./providers/gemini";
import { createGroqProvider } from "./providers/groq";
import type { LlmProvider } from "./providers/types";

// Provider selection.
//
// The backend used to be welded into this file. It is now chosen by
// LLM_PROVIDER so a deployment can switch without a code change — which
// matters because the two differ sharply in the ways that actually bite:
//
//   gemini  stronger on low-resource languages (Tamil, Telugu, Malayalam),
//           but the free tier allows only 20 requests/day.
//   groq    ~1000 requests and 8k tokens/minute, ~3s instead of ~30s, but
//           observed leaking CJK characters into Tamil output.
//
// Default is groq: an app that cannot answer at all is worse than one that
// occasionally words something awkwardly. Set LLM_PROVIDER=gemini to switch.
type ProviderId = "groq" | "gemini";

function resolveProviderId(): ProviderId {
  const raw = (process.env.LLM_PROVIDER || "groq").trim().toLowerCase();
  if (raw === "gemini" || raw === "google") return "gemini";
  if (raw === "groq") return "groq";
  // An unrecognised value is a config typo. Fail loudly at first use rather
  // than silently teaching with a backend nobody selected.
  throw new LlmError({
    kind: "unknown",
    message: `Unknown LLM_PROVIDER "${raw}"`,
    userMessage: `LLM_PROVIDER is set to "${raw}", which is not a supported backend. Use "groq" or "gemini".`,
    httpStatus: 500,
  });
}

let cachedProvider: LlmProvider | null = null;
let cachedProviderId: ProviderId | null = null;

function getProvider(): LlmProvider {
  const id = resolveProviderId();
  if (cachedProvider && cachedProviderId === id) return cachedProvider;
  cachedProvider = id === "gemini" ? createGeminiProvider() : createGroqProvider();
  cachedProviderId = id;
  return cachedProvider;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Salvages a JSON payload from a response that arrived wrapped in prose or a
 * markdown fence. With a JSON response format requested the model should
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

interface GenerateOptions {
  system: string;
  user: string;
  maxOutputTokens: number;
  /** "application/json" asks the backend for a strict, parseable JSON body. */
  responseMimeType: "application/json" | "text/plain";
}

async function generateContent({
  system,
  user,
  maxOutputTokens,
  responseMimeType,
}: GenerateOptions): Promise<string> {
  const provider = getProvider();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await provider.generate(
        { system, user, maxOutputTokens, responseMimeType, temperature: MODEL_TEMPERATURE },
        controller.signal
      );
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        lastError = new LlmError({
          kind: "timeout",
          message: `Timed out waiting for ${provider.modelId} after ${REQUEST_TIMEOUT_MS}ms`,
          userMessage:
            "The AI took too long to respond. Try again, or pick a shorter session length.",
          retryable: true,
          httpStatus: 504,
        });
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        break;
      }

      if (err instanceof LlmError) {
        // Only genuinely transient failures are worth another attempt. An
        // exhausted quota, a rejected key or an unknown model fails identically
        // every time, so retrying them only adds seconds of dead air before the
        // same error reaches the learner — which is what made the UI look
        // frozen and the buttons look broken.
        if (!err.retryable || attempt >= MAX_ATTEMPTS - 1) throw err;
        lastError = err;
        // Prefer the server's own retry hint over our guess when it sends one.
        await sleep(err.retryAfterMs ?? RETRY_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }

      // A fetch that rejects without an HTTP status never reached the provider
      // — DNS, TLS or offline. Worth one retry, but say plainly that it is a
      // connectivity problem rather than an AI one.
      if (err instanceof TypeError) {
        lastError = new LlmError({
          kind: "network",
          message: `Could not reach the ${provider.id} API: ${err.message}`,
          userMessage: "Could not reach the AI service. Check your internet connection and try again.",
          retryable: true,
          httpStatus: 503,
        });
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
          continue;
        }
        break;
      }

      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError ||
    new LlmError({
      kind: "unknown",
      message: `All ${MAX_ATTEMPTS} attempts to reach ${provider.modelId} failed`,
      userMessage: "Could not reach the AI service after several attempts. Try again in a moment.",
      retryable: true,
      httpStatus: 503,
    })
  );
}

/**
 * Runs a prompt and parses the reply as JSON of type T. Asks the backend for
 * JSON so the model emits a strict JSON body directly instead of prose or a
 * fenced code block that has to be scraped.
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
        message: `Failed to parse JSON from ${getProvider().modelId}: ${(err as Error).message}\nRaw: ${raw.slice(0, 500)}`,
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

/** The model currently in use, for diagnostics and error messages. */
export function activeModel(): string {
  return getProvider().modelId;
}

/** Which backend is currently selected ("groq" | "gemini"). */
export function activeProvider(): string {
  return getProvider().id;
}
