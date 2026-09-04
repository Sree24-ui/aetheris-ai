"use client";

import { apiRequest } from "./http";
import type { LearnerMemory, LearnerHistoryEntry, LearningPath } from "./types";

// Learner history lives in the database, scoped to the signed-in user
// (see src/lib/serverMemory.ts and src/app/api/history/*) instead of
// browser localStorage — so it follows the account across devices and two
// different accounts in the same browser no longer share history.
//
// H7: every function here used to `await fetch(...)` and discard the result.
// They now go through apiRequest and throw a RequestFailed the caller has to
// deal with, because the alternative — telling a learner their lesson was
// saved when the write 401'd — is worse than an error message.

export async function loadMemory(signal?: AbortSignal): Promise<LearnerMemory> {
  return apiRequest<LearnerMemory>("/api/history", { signal });
}

export interface SavedHistoryEntry {
  id: string;
  /** True when the server already held this entry — a safe retry, not a copy. */
  replayed: boolean;
}

/**
 * Saves one completed lesson.
 *
 * The entry carries a client-generated UUID, and the server treats a second
 * write of the same id as a replay rather than a duplicate row. That makes
 * retrying after a timeout safe, as long as the caller reuses the id from the
 * first attempt instead of minting a new one.
 */
export async function addHistoryEntry(entry: LearnerHistoryEntry): Promise<SavedHistoryEntry> {
  return apiRequest<SavedHistoryEntry>("/api/history", { method: "POST", body: entry });
}

export interface PathPosition {
  /** The step index the server now holds. */
  stepIndex: number;
}

export async function setCurrentPath(path: LearningPath, stepIndex = 0): Promise<PathPosition> {
  return apiRequest<PathPosition>("/api/history/path", {
    method: "POST",
    body: { path, stepIndex },
  });
}

/**
 * Moves the learner to the next step of their path.
 *
 * `fromStepIndex` is the step the finished lesson belonged to. The server only
 * advances when its own index still matches, so a duplicate, delayed or
 * out-of-order completion is a no-op that reports the current position rather
 * than skipping a step. `advanced` says which happened.
 */
export async function advancePath(
  fromStepIndex: number
): Promise<PathPosition & { advanced: boolean }> {
  return apiRequest<PathPosition & { advanced: boolean }>("/api/history/path/advance", {
    method: "POST",
    body: { fromStepIndex },
  });
}
