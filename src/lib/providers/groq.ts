import { LlmError, classifyOpenAIError } from "../llmError";
import type { GenerateRequest, LlmProvider } from "./types";

// Groq — OpenAI-compatible chat completions over their LPU inference stack.
//
// Chosen as an alternative backend for one reason above all: headroom. Gemini's
// free tier allows 20 generate_content requests per day, which a single lesson
// exhausts; Groq's returns x-ratelimit-limit-requests: 1000 alongside an
// 8,000 tokens/minute ceiling, and answers in ~3s rather than ~30s.
//
// Note the token ceiling is per MINUTE, so it — not the request count — is the
// binding constraint here. Keep TOKENS_LESSON_PLAN in mind: one 8192-token
// lesson plan is a large share of a minute's budget.
const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";

interface ChatCompletion {
  choices?: {
    message?: { content?: string | null };
    finish_reason?: string;
  }[];
}

function getApiKey(): string {
  const raw = process.env.GROQ_API_KEY;
  if (!raw || !raw.trim()) {
    throw new LlmError({
      kind: "auth",
      message: "GROQ_API_KEY is not set",
      userMessage:
        "GROQ_API_KEY is not set. Add it to .env.local, or set LLM_PROVIDER=gemini to use Gemini instead.",
      httpStatus: 401,
    });
  }
  const apiKey = raw.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (!apiKey) {
    throw new LlmError({
      kind: "auth",
      message: "GROQ_API_KEY contained only quotes",
      userMessage: "GROQ_API_KEY appears to contain only quotes. Check the value in .env.local.",
      httpStatus: 401,
    });
  }
  const badChar = [...apiKey].find((ch) => ch.charCodeAt(0) > 127 || ch.charCodeAt(0) < 32);
  if (badChar) {
    throw new LlmError({
      kind: "auth",
      message: "GROQ_API_KEY contains a non-Latin-1 character",
      userMessage:
        "GROQ_API_KEY contains an invalid character — re-copy the key as plain text into .env.local.",
      httpStatus: 401,
    });
  }
  return apiKey;
}

export function createGroqProvider(): LlmProvider {
  const baseUrl = process.env.GROQ_BASE_URL || DEFAULT_BASE_URL;
  const modelId = process.env.GROQ_MODEL || DEFAULT_MODEL;

  return {
    id: "groq",
    modelId,

    async generate(req: GenerateRequest, signal: AbortSignal): Promise<string> {
      const apiKey = getApiKey();

      const body = {
        model: modelId,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        // The OpenAI-compatible equivalent of Gemini's responseMimeType. The
        // pedagogical schemas depend on strict JSON, so this must track
        // responseMimeType exactly rather than being set once and forgotten.
        ...(req.responseMimeType === "application/json"
          ? { response_format: { type: "json_object" as const } }
          : {}),
        temperature: req.temperature,
        max_tokens: req.maxOutputTokens,
      };

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        throw classifyOpenAIError(res.status, await res.text(), res.headers.get("retry-after"));
      }

      const data = (await res.json()) as ChatCompletion;
      const choice = data.choices?.[0];
      const text = choice?.message?.content?.trim() ?? "";

      if (!text) {
        throw new LlmError({
          kind: choice?.finish_reason === "length" ? "truncated" : "blocked",
          message: `Groq returned an empty response (finish_reason: ${choice?.finish_reason ?? "unknown"})`,
          userMessage:
            choice?.finish_reason === "length"
              ? "The AI ran out of output budget before writing anything. Try a shorter lesson."
              : "The AI returned an empty response. Try again, or rephrase the topic.",
          httpStatus: 502,
        });
      }

      // Same reasoning as the Gemini path: a response cut off at the token
      // ceiling is unparseable JSON, and saying so beats a confusing parse
      // error three layers up.
      if (choice?.finish_reason === "length" && req.responseMimeType === "application/json") {
        throw new LlmError({
          kind: "truncated",
          message: `Groq response hit the ${req.maxOutputTokens}-token ceiling, so the JSON is incomplete`,
          userMessage:
            "The AI's answer was cut off before it finished. Try a shorter lesson (less time available) or a narrower topic.",
          httpStatus: 502,
        });
      }

      return text;
    },
  };
}
