"use client";

/**
 * Per-learner narration settings for the browser's speech synthesis.
 *
 * Stored locally rather than on the profile: the available voices depend on
 * the browser and OS the learner is sitting at, so a voice chosen on one
 * machine is often meaningless on another.
 */
export interface VoicePrefs {
  /** `SpeechSynthesisVoice.voiceURI`, or null to let the app pick by language. */
  voiceURI: string | null;
  /** 0.5 – 1.5, where 1 is the browser's normal pace. */
  rate: number;
  /** 0.5 – 1.5. */
  pitch: number;
  /** 0 – 1. */
  volume: number;
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  voiceURI: null,
  // Matches the hand-tuned values the lesson player used before these became
  // adjustable, so existing learners hear no change until they touch a slider.
  rate: 0.98,
  pitch: 1.02,
  volume: 1,
};

const STORAGE_KEY = "aetheris.voicePrefs.v1";

function clamp(n: number, min: number, max: number, fallback: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function loadVoicePrefs(): VoicePrefs {
  if (typeof window === "undefined") return DEFAULT_VOICE_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_PREFS;
    const parsed = JSON.parse(raw) as Partial<VoicePrefs>;
    return {
      voiceURI: typeof parsed.voiceURI === "string" ? parsed.voiceURI : null,
      rate: clamp(Number(parsed.rate), 0.5, 1.5, DEFAULT_VOICE_PREFS.rate),
      pitch: clamp(Number(parsed.pitch), 0.5, 1.5, DEFAULT_VOICE_PREFS.pitch),
      volume: clamp(Number(parsed.volume), 0, 1, DEFAULT_VOICE_PREFS.volume),
    };
  } catch {
    // Private mode, disabled site data, or corrupt JSON — fall back silently.
    return DEFAULT_VOICE_PREFS;
  }
}

export function saveVoicePrefs(prefs: VoicePrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage being unavailable must never break narration.
  }
}

// --- External store ------------------------------------------------------
// Exposed through useSyncExternalStore rather than useState + an effect: the
// stored value only exists on the client, so seeding state from localStorage
// during render would not match what the server rendered. The server snapshot
// is always the default, and React swaps in the real value after hydration.

let cached: VoicePrefs | null = null;
const listeners = new Set<() => void>();

export function subscribeVoicePrefs(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Must return a stable reference between changes or React will loop. */
export function getVoicePrefsSnapshot(): VoicePrefs {
  if (!cached) cached = loadVoicePrefs();
  return cached;
}

export function getVoicePrefsServerSnapshot(): VoicePrefs {
  return DEFAULT_VOICE_PREFS;
}

export function setVoicePrefs(next: VoicePrefs): void {
  cached = next;
  saveVoicePrefs(next);
  for (const listener of listeners) listener();
}
