/**
 * Fixed-window request counters (H5).
 *
 * The project had no rate limiting at all, so a retry loop or a signed-in
 * attacker could drain the deployment's entire model budget, database
 * connections and serverless concurrency in a few seconds.
 *
 * ponytail: in-process counters, not a shared store. On a single instance
 * this is exact; across N serverless instances the effective limit is up to
 * N x the configured value, which still bounds the damage by orders of
 * magnitude versus none. Moving to a shared store (Redis, or a Postgres
 * table) is the upgrade path if the deployment ever runs many instances —
 * `consume()` is the only function that would change.
 */

interface Window {
  count: number;
  /** Epoch ms when this window ends and the count resets. */
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Bounds the map so a flood of distinct keys cannot grow it without limit. */
const MAX_TRACKED_KEYS = 10_000;

function prune(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  if (windows.size > MAX_TRACKED_KEYS) {
    // Oldest-first: Map preserves insertion order, so this drops the entries
    // least likely to still be in an active window.
    let toDrop = windows.size - MAX_TRACKED_KEYS;
    for (const key of windows.keys()) {
      windows.delete(key);
      if (--toDrop <= 0) break;
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests still available in the current window. */
  remaining: number;
  /** Seconds until the window resets — sent as Retry-After on a 429. */
  retryAfterSeconds: number;
  limit: number;
}

/**
 * Records one request against `key` and reports whether it is allowed.
 * `now` is injectable so the behaviour is testable without waiting.
 */
export function consume(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  prune(now);
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0, limit };
  }
  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds, limit };
  }
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds, limit };
}

/** Test seam: drops all counters. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * Default budgets. Every model-backed route also draws on the shared daily
 * budget, so a caller cannot dodge the cost ceiling by spreading requests
 * across endpoints.
 */
export const RATE_LIMITS = {
  /** Cheap, database-only endpoints. */
  standard: { limit: 60, windowMs: 60_000 },
  /** Endpoints that call the model: bounded per minute... */
  model: { limit: 20, windowMs: 60_000 },
  /** ...and per day, across all of them together. */
  modelDaily: { limit: 300, windowMs: 24 * 60 * 60_000 },
  /** Uploads additionally do parsing and embedding work. */
  upload: { limit: 10, windowMs: 60 * 60_000 },
  /** Unauthenticated account creation, keyed by client address. */
  register: { limit: 5, windowMs: 60 * 60_000 },
} as const;
