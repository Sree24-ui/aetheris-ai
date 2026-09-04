import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { RequestFailed, apiRequest, errorMessage, isSessionExpired } from "./http";

/**
 * Regression tests for H7.
 *
 * `memory.ts` used to `await fetch(...)` and never look at the result, so a
 * 401, a 429, a 500 and a dropped connection all looked like a successful
 * save. Every case below has to become a thrown, described failure — the
 * point of the fix is that a caller cannot accidentally ignore one.
 */

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replaces fetch for one test. */
function stubFetch(handler: (input: string, init?: RequestInit) => Promise<Response> | Response) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init))) as typeof fetch;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function expectFailure(promise: Promise<unknown>): Promise<RequestFailed> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof RequestFailed, `expected RequestFailed, got ${String(err)}`);
    return err;
  }
  throw new Error("expected the request to reject");
}

test("a successful response is parsed and returned", async () => {
  stubFetch(() => json({ history: [], weakConcepts: [] }));
  const body = await apiRequest<{ history: unknown[] }>("/api/history");
  assert.deepEqual(body.history, []);
});

test("a POST sends JSON with the right content type", async () => {
  let seen: RequestInit | undefined;
  stubFetch((_input, init) => {
    seen = init;
    return json({ ok: true });
  });
  await apiRequest("/api/history", { method: "POST", body: { id: "x" } });
  assert.equal(seen?.method, "POST");
  assert.equal((seen?.headers as Record<string, string>)["Content-Type"], "application/json");
  assert.equal(seen?.body, JSON.stringify({ id: "x" }));
});

test("a GET sends no body and no content type", async () => {
  let seen: RequestInit | undefined;
  stubFetch((_input, init) => {
    seen = init;
    return json({});
  });
  await apiRequest("/api/history");
  assert.equal(seen?.body, undefined);
  assert.equal(seen?.headers, undefined);
});

test("every failing status becomes a thrown, described failure", async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 429, 500, 502, 503]) {
    stubFetch(() => json({}, status));
    const err = await expectFailure(apiRequest("/api/history", { method: "POST", body: {} }));
    assert.equal(err.status, status);
    assert.ok(err.message.length > 0, `status ${status} produced no message`);
  }
});

test("the server's own message and request id are surfaced", async () => {
  stubFetch(() =>
    json(
      {
        error: "You have made too many requests.",
        kind: "limit",
        retryable: true,
        retryAfterMs: 30_000,
        requestId: "abc-123",
      },
      429
    )
  );
  const err = await expectFailure(apiRequest("/api/instruction", { method: "POST", body: {} }));
  assert.equal(err.message, "You have made too many requests.");
  assert.equal(err.kind, "limit");
  assert.equal(err.retryable, true);
  assert.equal(err.retryAfterMs, 30_000);
  assert.equal(err.requestId, "abc-123");
});

test("Retry-After is read when the body does not carry a hint", async () => {
  stubFetch(() => json({ error: "slow down" }, 429, { "Retry-After": "12" }));
  const err = await expectFailure(apiRequest("/api/instruction", { method: "POST", body: {} }));
  assert.equal(err.retryAfterMs, 12_000);
});

test("a non-JSON error body still produces a usable failure", async () => {
  stubFetch(() => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
  const err = await expectFailure(apiRequest("/api/history"));
  assert.equal(err.status, 502);
  assert.ok(!err.message.includes("<html>"), err.message);
  assert.equal(err.retryable, true);
});

test("a network failure is reported as one, not as an empty result", async () => {
  globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
  const err = await expectFailure(apiRequest("/api/history"));
  assert.equal(err.status, 0);
  assert.equal(err.kind, "network");
  assert.equal(err.retryable, true);
});

test("4xx failures are not offered as retryable, 5xx and 429 are", async () => {
  for (const [status, retryable] of [
    [400, false],
    [401, false],
    [404, false],
    [429, true],
    [500, true],
    [503, true],
  ] as const) {
    stubFetch(() => new Response("", { status }));
    const err = await expectFailure(apiRequest("/api/history"));
    assert.equal(err.retryable, retryable, `status ${status}`);
  }
});

test("an aborted request rethrows AbortError rather than reporting a failure", async () => {
  globalThis.fetch = (() =>
    Promise.reject(new DOMException("aborted", "AbortError"))) as typeof fetch;
  await assert.rejects(apiRequest("/api/history"), (err: unknown) => {
    assert.ok(err instanceof DOMException);
    assert.equal(err.name, "AbortError");
    return true;
  });
});

test("an empty 200 body is not treated as a parse failure", async () => {
  stubFetch(() => new Response("", { status: 200 }));
  const body = await apiRequest("/api/history/path/advance", { method: "POST", body: {} });
  assert.equal(body, undefined);
});

test("an expired session is identifiable so the UI can say so", async () => {
  stubFetch(() => json({ error: "You need to be signed in to do that." }, 401));
  const err = await expectFailure(apiRequest("/api/history"));
  assert.equal(isSessionExpired(err), true);
  assert.equal(isSessionExpired(new Error("something else")), false);
});

test("errorMessage produces a sentence for anything thrown", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage("just a string"), "Something went wrong.");
  assert.equal(errorMessage(undefined), "Something went wrong.");
});
