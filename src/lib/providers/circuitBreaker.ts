/**
 * Provider health tracking and circuit breaking.
 *
 * Provider selection had no runtime failover, health score or breaker: if the
 * configured backend was down, every request spent its full retry envelope
 * discovering that again, and a provider outage became an application outage
 * that also burned the request budget.
 *
 * The breaker is the standard three-state one. What matters here is *which*
 * failures count: an exhausted quota or a rejected key is a permanent fault of
 * that provider and should open the circuit immediately, while a single
 * timeout is ordinary and should not.
 *
 * ponytail: state is per process, like the rate limiter. Across N instances
 * that means each learns for itself, which is still far better than none
 * learning at all; a shared store would be the upgrade if it ever matters.
 */

export type BreakerState = "closed" | "open" | "half-open";

/** What a provider failure was, as far as the breaker is concerned. */
export type FailureKind = "transient" | "permanent";

export interface BreakerOptions {
  /** Consecutive transient failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open before a trial request is allowed. */
  openMs: number;
  /** Consecutive successes in half-open before closing again. */
  successThreshold: number;
}

export const DEFAULT_BREAKER: BreakerOptions = {
  failureThreshold: 3,
  openMs: 30_000,
  successThreshold: 1,
};

interface Health {
  state: BreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  /** Epoch ms when an open circuit may next be tried. */
  retryAt: number;
  totalFailures: number;
  totalSuccesses: number;
}

const health = new Map<string, Health>();

function get(provider: string): Health {
  const existing = health.get(provider);
  if (existing) return existing;
  const fresh: Health = {
    state: "closed",
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    retryAt: 0,
    totalFailures: 0,
    totalSuccesses: 0,
  };
  health.set(provider, fresh);
  return fresh;
}

/**
 * Whether a request to `provider` should be attempted.
 *
 * An open circuit lets exactly one request through once `openMs` has passed —
 * the half-open trial — so recovery is detected without a thundering herd.
 */
export function shouldAttempt(provider: string, now: number = Date.now()): boolean {
  const entry = get(provider);
  if (entry.state === "closed") return true;
  if (entry.state === "half-open") return true;
  if (now >= entry.retryAt) {
    entry.state = "half-open";
    entry.consecutiveSuccesses = 0;
    return true;
  }
  return false;
}

export function recordSuccess(
  provider: string,
  options: BreakerOptions = DEFAULT_BREAKER
): void {
  const entry = get(provider);
  entry.consecutiveFailures = 0;
  entry.totalSuccesses += 1;
  if (entry.state === "half-open") {
    entry.consecutiveSuccesses += 1;
    if (entry.consecutiveSuccesses >= options.successThreshold) {
      entry.state = "closed";
      entry.consecutiveSuccesses = 0;
    }
    return;
  }
  entry.state = "closed";
}

export function recordFailure(
  provider: string,
  kind: FailureKind,
  options: BreakerOptions = DEFAULT_BREAKER,
  now: number = Date.now()
): void {
  const entry = get(provider);
  entry.totalFailures += 1;
  entry.consecutiveSuccesses = 0;
  entry.consecutiveFailures += 1;

  // A rejected key or an exhausted quota will fail identically for every
  // caller until someone changes something. Waiting for three of those before
  // opening the circuit just wastes three more requests.
  const open =
    kind === "permanent" ||
    entry.state === "half-open" ||
    entry.consecutiveFailures >= options.failureThreshold;

  if (open) {
    entry.state = "open";
    entry.retryAt = now + options.openMs;
  }
}

export interface ProviderHealth {
  provider: string;
  state: BreakerState;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  /** Seconds until an open circuit will next be tried; 0 when it is not open. */
  retryInSeconds: number;
}

/** A snapshot, for logging and for a health endpoint. */
export function snapshot(now: number = Date.now()): ProviderHealth[] {
  return [...health.entries()].map(([provider, entry]) => ({
    provider,
    state: entry.state,
    consecutiveFailures: entry.consecutiveFailures,
    totalFailures: entry.totalFailures,
    totalSuccesses: entry.totalSuccesses,
    retryInSeconds:
      entry.state === "open" ? Math.max(0, Math.ceil((entry.retryAt - now) / 1000)) : 0,
  }));
}

/** Test seam. */
export function resetBreakers(): void {
  health.clear();
}
