"use client";

import type { LearnerMemory, LearnerHistoryEntry, LearningPath } from "./types";

const KEY = "ai-teacher-memory-v1";

const EMPTY: LearnerMemory = {
  history: [],
  weakConcepts: [],
  strongConcepts: [],
};

export function loadMemory(): LearnerMemory {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    return JSON.parse(raw) as LearnerMemory;
  } catch {
    return EMPTY;
  }
}

export function saveMemory(memory: LearnerMemory) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(memory));
}

export function addHistoryEntry(entry: LearnerHistoryEntry) {
  const mem = loadMemory();
  mem.history = [entry, ...mem.history].slice(0, 50);
  const weak = new Set(mem.weakConcepts);
  const strong = new Set(mem.strongConcepts);
  entry.weakAreas.forEach((w) => {
    weak.add(w);
    strong.delete(w);
  });
  entry.strongAreas.forEach((s) => {
    strong.add(s);
    weak.delete(s);
  });
  mem.weakConcepts = Array.from(weak);
  mem.strongConcepts = Array.from(strong);
  saveMemory(mem);
}

export function setCurrentPath(path: LearningPath, stepIndex = 0) {
  const mem = loadMemory();
  mem.currentPath = path;
  mem.currentStepIndex = stepIndex;
  saveMemory(mem);
}

export function advancePath() {
  const mem = loadMemory();
  if (mem.currentPath && mem.currentStepIndex !== undefined) {
    mem.currentStepIndex = Math.min(mem.currentStepIndex + 1, mem.currentPath.steps.length);
    saveMemory(mem);
  }
}

export function clearMemory() {
  saveMemory(EMPTY);
}
