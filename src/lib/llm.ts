const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const PRIMARY_MODEL = process.env.OPENROUTER_MODEL || "minimax/minimax-m3:free";
const FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS || "z-ai/glm-5.2:free,google/gemma-4-31b-it:free,openrouter/free")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const MODEL_CHAIN = [PRIMARY_MODEL, ...FALLBACK_MODELS.filter((m) => m !== PRIMARY_MODEL)];

function getApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env.local to enable the AI Teacher."
    );
  }
  return apiKey;
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const arrStart = candidate.indexOf("[");
  let from = start;
  if (arrStart !== -1 && (start === -1 || arrStart < start)) from = arrStart;
  if (from === -1) return candidate.trim();
  const lastCurly = candidate.lastIndexOf("}");
  const lastSquare = candidate.lastIndexOf("]");
  const to = Math.max(lastCurly, lastSquare);
  return candidate.slice(from, to + 1).trim();
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

async function chatCompletion(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const apiKey = getApiKey();
  let lastError: Error | null = null;

  // One attempt per model within a tight timeout, so a slow/hung free-tier
  // provider fails over to the next model quickly instead of compounding
  // into minutes of total wait. A 429 gets exactly one short retry on the
  // same model (rate limits usually clear in ~1s); anything else moves on.
  for (const model of MODEL_CHAIN) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 22_000);
      try {
        const res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            messages,
          }),
          signal: controller.signal,
        });

        if (res.status === 429) {
          const body = await res.text();
          lastError = new Error(`Rate limited on ${model}: ${body.slice(0, 200)}`);
          if (attempt === 0) {
            await sleep(1000);
            continue;
          }
          break;
        }

        if (!res.ok) {
          const body = await res.text();
          lastError = new Error(`OpenRouter error on ${model} (${res.status}): ${body.slice(0, 300)}`);
          break;
        }

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") {
          lastError = new Error(`Empty response from ${model}`);
          break;
        }
        return content;
      } catch (err) {
        const isAbort = err instanceof Error && err.name === "AbortError";
        lastError = isAbort ? new Error(`Timed out waiting for ${model}`) : (err as Error);
        break;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  throw lastError || new Error("All model attempts failed");
}

export async function callModelJSON<T>(
  system: string,
  userPrompt: string,
  maxTokens = 4096
): Promise<T> {
  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
    maxTokens
  );
  const jsonStr = extractJson(raw);
  try {
    return JSON.parse(jsonStr) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from model response: ${(err as Error).message}\nRaw: ${raw.slice(0, 500)}`
    );
  }
}

export async function callModelText(
  system: string,
  userPrompt: string,
  maxTokens = 1024
): Promise<string> {
  return chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: userPrompt },
    ],
    maxTokens
  );
}

export const MODEL = PRIMARY_MODEL;
