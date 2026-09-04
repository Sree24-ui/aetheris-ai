"use client";

/**
 * Interface preferences that change how the app looks and moves.
 *
 * Stored locally rather than on the profile for the same reason voice prefs
 * are: they describe the device you're sitting at. Motion in particular is an
 * accessibility choice that belongs to the machine, not the account.
 */

export const ACCENTS = {
  lavender: {
    label: "Nebula Lavender",
    vars: {
      "--color-primary": "#d0bcff",
      "--color-primary-container": "#a078ff",
      "--color-primary-fixed-dim": "#d0bcff",
      "--color-on-primary": "#3c0091",
      "--color-on-primary-container": "#340080",
      "--color-surface-tint": "#d0bcff",
    },
  },
  cyan: {
    label: "Aurora Cyan",
    vars: {
      "--color-primary": "#89ceff",
      "--color-primary-container": "#00a2e6",
      "--color-primary-fixed-dim": "#89ceff",
      "--color-on-primary": "#00344d",
      "--color-on-primary-container": "#00344e",
      "--color-surface-tint": "#89ceff",
    },
  },
  solar: {
    label: "Solar Flare",
    vars: {
      "--color-primary": "#ffb690",
      "--color-primary-container": "#ec6a06",
      "--color-primary-fixed-dim": "#ffb690",
      "--color-on-primary": "#552100",
      "--color-on-primary-container": "#4a1c00",
      "--color-surface-tint": "#ffb690",
    },
  },
  slate: {
    label: "Deep Space",
    vars: {
      "--color-primary": "#b9c6e4",
      "--color-primary-container": "#5b6b8f",
      "--color-primary-fixed-dim": "#b9c6e4",
      "--color-on-primary": "#0b1729",
      "--color-on-primary-container": "#e2e9f7",
      "--color-surface-tint": "#b9c6e4",
    },
  },
} as const;

export type Accent = keyof typeof ACCENTS;
export const ACCENT_KEYS = Object.keys(ACCENTS) as Accent[];

export const DENSITIES = ["off", "sparse", "dense"] as const;
export type Density = (typeof DENSITIES)[number];

/** Ordered slowest → fastest so the settings slider can index straight into it. */
export const MOTIONS = ["still", "calm", "fluid"] as const;
export type Motion = (typeof MOTIONS)[number];

export interface Appearance {
  accent: Accent;
  density: Density;
  motion: Motion;
}

export const DEFAULT_APPEARANCE: Appearance = {
  accent: "lavender",
  density: "dense",
  motion: "calm",
};

const STORAGE_KEY = "aetheris.appearance.v1";

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function loadAppearance(): Appearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      accent: oneOf(parsed.accent, ACCENT_KEYS, DEFAULT_APPEARANCE.accent),
      density: oneOf(parsed.density, DENSITIES, DEFAULT_APPEARANCE.density),
      motion: oneOf(parsed.motion, MOTIONS, DEFAULT_APPEARANCE.motion),
    };
  } catch {
    // Private mode, disabled site data, or corrupt JSON — fall back silently.
    return DEFAULT_APPEARANCE;
  }
}

/** Writes the preferences onto <html>, where the CSS in globals.css reads them. */
export function applyAppearance(next: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(ACCENTS[next.accent].vars)) {
    root.style.setProperty(name, value);
  }
  root.dataset.bubbles = next.density;
  root.dataset.motion = next.motion;
}

// --- External store ------------------------------------------------------
// Same shape as voicePrefs: the stored value only exists on the client, so the
// server snapshot is always the default and React swaps in the real value
// after hydration.

let cached: Appearance | null = null;
const listeners = new Set<() => void>();

export function subscribeAppearance(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Must return a stable reference between changes or React will loop. */
export function getAppearanceSnapshot(): Appearance {
  if (!cached) cached = loadAppearance();
  return cached;
}

export function getAppearanceServerSnapshot(): Appearance {
  return DEFAULT_APPEARANCE;
}

export function setAppearance(next: Appearance): void {
  cached = next;
  applyAppearance(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage being unavailable must never break the interface.
  }
  for (const listener of listeners) listener();
}
