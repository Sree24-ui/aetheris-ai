"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  applyAppearance,
  getAppearanceServerSnapshot,
  getAppearanceSnapshot,
  subscribeAppearance,
} from "@/lib/appearance";

/**
 * Keeps <html> in sync with the stored interface preferences. Renders nothing.
 *
 * The *initial* application happens before paint, in the bootstrap script the
 * root layout inlines — doing it here during render made every one of those
 * attributes a hydration mismatch. This effect only has to cover later changes,
 * which is why writing after paint is fine.
 */
export default function AppearanceEffect() {
  const appearance = useSyncExternalStore(
    subscribeAppearance,
    getAppearanceSnapshot,
    getAppearanceServerSnapshot
  );
  useEffect(() => {
    applyAppearance(appearance);
  }, [appearance]);
  return null;
}
