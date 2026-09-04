import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BREAKER,
  recordFailure,
  recordSuccess,
  resetBreakers,
  shouldAttempt,
  snapshot,
} from "./circuitBreaker";

/**
 * Provider selection had no failover, health score or breaker, so a provider
 * outage became an application outage: every request spent its full retry
 * envelope rediscovering that the backend was down, and burned budget doing it.
 */

const opts = { failureThreshold: 3, openMs: 30_000, successThreshold: 1 };

beforeEach(() => resetBreakers());

test("a healthy provider is always attempted", () => {
  assert.equal(shouldAttempt("groq", 0), true);
  recordSuccess("groq", opts);
  assert.equal(shouldAttempt("groq", 0), true);
});

test("transient failures have to accumulate before the circuit opens", () => {
  recordFailure("groq", "transient", opts, 0);
  assert.equal(shouldAttempt("groq", 0), true, "one timeout must not open it");
  recordFailure("groq", "transient", opts, 0);
  assert.equal(shouldAttempt("groq", 0), true);
  recordFailure("groq", "transient", opts, 0);
  assert.equal(shouldAttempt("groq", 0), false, "three should");
});

test("a permanent failure opens the circuit at once", () => {
  // A rejected key or an exhausted quota fails identically for every caller
  // until someone changes something. Spending two more requests to confirm
  // that is exactly the waste this replaces.
  recordFailure("groq", "permanent", opts, 0);
  assert.equal(shouldAttempt("groq", 0), false);
});

test("a success resets the run of failures", () => {
  recordFailure("groq", "transient", opts, 0);
  recordFailure("groq", "transient", opts, 0);
  recordSuccess("groq", opts);
  recordFailure("groq", "transient", opts, 0);
  assert.equal(shouldAttempt("groq", 0), true);
});

test("an open circuit lets exactly one trial through once it has cooled", () => {
  recordFailure("groq", "permanent", opts, 0);
  assert.equal(shouldAttempt("groq", 29_999), false);
  assert.equal(shouldAttempt("groq", 30_000), true, "the trial request");
});

test("a failed trial re-opens the circuit immediately", () => {
  recordFailure("groq", "permanent", opts, 0);
  shouldAttempt("groq", 30_000); // half-open
  recordFailure("groq", "transient", opts, 30_000);
  assert.equal(shouldAttempt("groq", 30_001), false);
  assert.equal(shouldAttempt("groq", 60_001), true);
});

test("a successful trial closes the circuit", () => {
  recordFailure("groq", "permanent", opts, 0);
  shouldAttempt("groq", 30_000);
  recordSuccess("groq", opts);
  assert.equal(shouldAttempt("groq", 30_001), true);
  // And it is genuinely closed, not still counting down.
  assert.equal(snapshot(30_001).find((p) => p.provider === "groq")?.state, "closed");
});

test("providers are tracked independently", () => {
  recordFailure("groq", "permanent", opts, 0);
  assert.equal(shouldAttempt("groq", 0), false);
  assert.equal(shouldAttempt("gemini", 0), true);
});

test("the snapshot reports what an operator needs to see", () => {
  recordSuccess("gemini", opts);
  recordFailure("groq", "permanent", opts, 0);
  const byProvider = new Map(snapshot(10_000).map((p) => [p.provider, p]));

  assert.equal(byProvider.get("groq")?.state, "open");
  assert.equal(byProvider.get("groq")?.retryInSeconds, 20);
  assert.equal(byProvider.get("groq")?.totalFailures, 1);
  assert.equal(byProvider.get("gemini")?.state, "closed");
  assert.equal(byProvider.get("gemini")?.totalSuccesses, 1);
  assert.equal(byProvider.get("gemini")?.retryInSeconds, 0);
});

test("the shipped defaults are not so lax as to be pointless", () => {
  assert.ok(DEFAULT_BREAKER.failureThreshold <= 5);
  assert.ok(DEFAULT_BREAKER.openMs >= 5_000);
});
