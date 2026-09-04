import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { ApiError, readValidatedBody, toSafeErrorResponse } from "./http";
import { LlmError } from "../llmError";

/**
 * Regression tests for the transport half of H2 and H5: handlers used to call
 * `await req.json()` with no size limit and no validation, then cast the
 * result. The final test covers the error-leak the audit found in
 * `toErrorResponse`, which returned raw `err.message` — driver internals and
 * all — to the browser.
 */

const schema = z.object({ topic: z.string().min(1).max(20), count: z.number().int() });

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://example.invalid/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function expectApiError(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${String(err)}`);
    return err;
  }
  throw new Error("expected the call to reject");
}

test("a valid body is parsed and typed", async () => {
  const body = await readValidatedBody(request(JSON.stringify({ topic: "algebra", count: 2 })), schema);
  assert.deepEqual(body, { topic: "algebra", count: 2 });
});

test("a body over the limit is refused with 413 before parsing", async () => {
  const oversized = JSON.stringify({ topic: "x".repeat(5000), count: 1 });
  const err = await expectApiError(readValidatedBody(request(oversized), schema, 1024));
  assert.equal(err.status, 413);
});

test("a lying content-length cannot get a large body past the limit", async () => {
  const oversized = JSON.stringify({ topic: "x".repeat(5000), count: 1 });
  // Header claims the body is tiny; the real length is still checked.
  const err = await expectApiError(
    readValidatedBody(request(oversized, { "content-length": "10" }), schema, 1024)
  );
  assert.equal(err.status, 413);
});

test("an oversized content-length is refused even with a small body", async () => {
  const err = await expectApiError(
    readValidatedBody(request("{}", { "content-length": "99999999" }), schema, 1024)
  );
  assert.equal(err.status, 413);
});

test("a non-JSON body is refused with 400", async () => {
  const err = await expectApiError(readValidatedBody(request("not json"), schema));
  assert.equal(err.status, 400);
});

test("a body that does not match the schema is refused with 400", async () => {
  for (const body of [
    {},
    { topic: "", count: 1 },
    { topic: "algebra" },
    { topic: "algebra", count: 1.5 },
    { topic: "x".repeat(40), count: 1 },
    { topic: ["algebra"], count: 1 },
    { topic: { toString: "algebra" }, count: 1 },
  ]) {
    const err = await expectApiError(readValidatedBody(request(JSON.stringify(body)), schema));
    assert.equal(err.status, 400, JSON.stringify(body));
  }
});

test("validation messages name fields but never echo values", async () => {
  const secret = "SUPER-SECRET-VALUE";
  const err = await expectApiError(
    readValidatedBody(request(JSON.stringify({ topic: secret + "x".repeat(50), count: 1 })), schema)
  );
  assert.ok(err.message.includes("topic"), err.message);
  assert.ok(!err.message.includes(secret), err.message);
});

// --- Error mapping --------------------------------------------------------

test("an unexpected error never reaches the client verbatim", async () => {
  const internal = new Error(
    'relation "users" does not exist at Connection.parseE (/var/task/node_modules/pg/lib/connection.js:1)'
  );
  const response = toSafeErrorResponse(internal, "req-1");
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.ok(!body.error.includes("pg/lib"), body.error);
  assert.ok(!body.error.includes("relation"), body.error);
  assert.equal(body.requestId, "req-1");
});

test("an ApiError keeps its own status, message and retry hint", async () => {
  const response = toSafeErrorResponse(new ApiError(429, "limit", "Too many.", 12), "req-2");
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "12");
  const body = await response.json();
  assert.equal(body.error, "Too many.");
  assert.equal(body.retryAfterMs, 12_000);
});

test("an LlmError surfaces its learner-facing message, not its internal one", async () => {
  const err = new LlmError({
    kind: "quota",
    message: "Groq quota exhausted (429): key sk-abcdef is over its daily allowance",
    userMessage: "The daily request allowance is used up.",
    httpStatus: 429,
  });
  const response = toSafeErrorResponse(err, "req-3");
  const body = await response.json();
  assert.equal(body.error, "The daily request allowance is used up.");
  assert.ok(!body.error.includes("sk-abcdef"));
});
