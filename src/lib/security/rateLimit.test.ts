import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RATE_LIMITS, consume, resetRateLimits } from "./rateLimit";

/** Regression tests for H5's quota half: the project had no limiter at all. */

beforeEach(() => resetRateLimits());

test("requests inside the limit are allowed and counted down", () => {
  const now = 1_000_000;
  for (let i = 1; i <= 3; i++) {
    const result = consume("k", 3, 60_000, now);
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 3 - i);
  }
});

test("the request after the limit is refused with a retry hint", () => {
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) consume("k", 3, 60_000, now);
  const refused = consume("k", 3, 60_000, now + 1000);
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.ok(refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= 60);
});

test("the window resets and the caller is allowed again", () => {
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) consume("k", 3, 60_000, now);
  assert.equal(consume("k", 3, 60_000, now + 30_000).allowed, false);
  assert.equal(consume("k", 3, 60_000, now + 60_001).allowed, true);
});

test("counters are per key, so one caller cannot exhaust another's budget", () => {
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) consume("user:1", 3, 60_000, now);
  assert.equal(consume("user:1", 3, 60_000, now).allowed, false);
  assert.equal(consume("user:2", 3, 60_000, now).allowed, true);
});

test("expired windows do not accumulate", () => {
  for (let i = 0; i < 500; i++) consume(`key-${i}`, 1, 1000, 1_000_000);
  // Advancing past every window and consuming once prunes the stale entries.
  const result = consume("key-0", 1, 1000, 1_100_000);
  assert.equal(result.allowed, true);
});

test("the configured budgets are actually restrictive", () => {
  // A deliberately loud assertion: raising these to an unbounded value is the
  // exact regression the audit found, so it should require editing a test.
  assert.ok(RATE_LIMITS.model.limit <= 60, "model budget must stay bounded");
  assert.ok(RATE_LIMITS.modelDaily.limit <= 2000, "daily model budget must stay bounded");
  assert.ok(RATE_LIMITS.upload.limit <= 60, "upload budget must stay bounded");
  assert.ok(RATE_LIMITS.register.limit <= 20, "registration budget must stay bounded");
});
