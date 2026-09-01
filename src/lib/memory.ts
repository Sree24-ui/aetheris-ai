"use client";

import type { LearnerMemory, LearnerHistoryEntry, LearningPath } from "./types";

const EMPTY: LearnerMemory = {
  history: [],
  weakConcepts: [],
  strongConcepts: [],
};

// Learner history now lives in the database, scoped to the signed-in user
// (see src/lib/serverMemory.ts and src/app/api/history/*) instead of
// browser localStorage — so it follows the account across devices and two
// different accounts in the same browser no longer share history.

export async function loadMemory(): Promise<LearnerMemory> {
  try {
    const res = await fetch("/api/history");
    if (!res.ok) return EMPTY;
    return (await res.json()) as LearnerMemory;
  } catch {
    return EMPTY;
  }
}

export async function addHistoryEntry(entry: LearnerHistoryEntry): Promise<void> {
  await fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  });
}

export async function setCurrentPath(path: LearningPath, stepIndex = 0): Promise<void> {
  await fetch("/api/history/path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, stepIndex }),
  });
}

export async function advancePath(): Promise<void> {
  await fetch("/api/history/path/advance", { method: "POST" });
}
