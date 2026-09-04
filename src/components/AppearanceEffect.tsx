"use client";

import { useSyncExternalStore } from "react";
import {
  applyAppearance,
  getAppearanceServerSnapshot,
  getAppearanceSnapshot,
  subscribeAppearance,
} from "@/lib/appearance";

/**
 * Applies the stored interface preferences to <html> on every page, including
 * the marketing and auth screens. Renders nothing.
 *
 * The write happens during render rather than in an effect so the accent is in
 * place before the first paint after hydration; without that the app flashes
 * the default lavender for a frame on every navigation.
 */
export default function AppearanceEffect() {
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getAppearanceServerSnapshot
  );
  if (typeof document !== "undefined") applyAppearance(appearance);
  return null;
}
