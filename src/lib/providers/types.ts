/**
 * The contract every model backend implements.
 *
 * Retry, timeout and backoff are NOT the provider's job — those live once in
 * llm.ts so behaviour cannot drift between backends. A provider performs a
 * single attempt and either returns text or throws an LlmError describing why
 * it failed, using the shared vocabulary in llmError.ts.
 */
export interface GenerateRequest {
  system: string;
  user: string;
  maxOutputTokens: number;
  /**
   * "application/json" asks the backend for a strict, parseable JSON body.
   * Every provider must honour this — the pedagogical schemas depend on it.
   */
  responseMimeType: "application/json" | "text/plain";
  temperature: number;
}

export interface LlmProvider {
  /** Stable identifier used in logs and error messages, e.g. "gemini". */
  readonly id: string;
  /** The concrete model this provider will call. */
  readonly modelId: string;
  /** One attempt. Throws LlmError; never retries internally. */
  generate(req: GenerateRequest, signal: AbortSignal): Promise<string>;
}
