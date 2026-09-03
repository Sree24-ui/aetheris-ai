import { APP_NAME } from "../appConfig";
import { LlmError, classifyGoogleError } from "../llmError";
import type { GenerateRequest, LlmProvider } from "./types";

// Google Gen AI (Gemini) REST integration.
//
// Uses the generateContent REST endpoint rather than the @google/genai SDK:
// it needs no extra dependency, matches the fetch style used elsewhere in the
// project, and keeps the serverless bundle small (this app already had to work
// around native-module bundling for onnxruntime).
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.6-flash";

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

export function createGeminiProvider(): LlmProvider {
  const baseUrl = process.env.GEMINI_BASE_URL || DEFAULT_BASE_URL;
  const modelId = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  // Gemini 2.5 models reason with internal "thinking" tokens that are billed
  // against maxOutputTokens. Left on, a small budget (the concept-extraction
  // call asks for only 300) can be consumed entirely by thinking, returning an
  // empty candidate with finishReason MAX_TOKENS and no usable JSON. Thinking
  // is disabled by default so the existing per-call budgets behave
  // predictably; set GEMINI_THINKING_BUDGET to re-enable it (-1 lets the model
  // decide). Note that Gemini 3.x models may reject a budget of 0 — if calls
  // start failing with 400 after a model upgrade, set this to -1.
  const thinkingBudget = Number(process.env.GEMINI_THINKING_BUDGET ?? 0);

  return {
    id: "gemini",
    modelId,

    async generate(req: GenerateRequest, signal: AbortSignal): Promise<string> {
      const apiKey = getApiKey();
      const url = `${baseUrl}/models/${modelId}:generateContent`;

      const body = {
        // Gemini takes the system prompt as its own field rather than as a
        // pseudo-message in the conversation.
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          maxOutputTokens: req.maxOutputTokens,
          responseMimeType: req.responseMimeType,
          temperature: req.temperature,
          ...(thinkingBudget >= 0 ? { thinkingConfig: { thinkingBudget } } : {}),
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          // Sent as a header, never as a query parameter — a key in the URL
          // leaks into logs, proxies and error traces.
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        throw classifyGoogleError(res.status, await res.text());
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
              `Gemini hit the ${req.maxOutputTokens}-token output limit before producing any text. ` +
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
      if (candidate.finishReason === "MAX_TOKENS" && req.responseMimeType === "application/json") {
        throw new LlmError({
          kind: "truncated",
          message: `Gemini response was truncated at the ${req.maxOutputTokens}-token limit, so the JSON is incomplete`,
          userMessage:
            "The AI's answer was cut off before it finished. Try a shorter lesson (less time available) or a narrower topic.",
          httpStatus: 502,
        });
      }

      return text;
    },
  };
}
