import type { LessonSection } from "./types";

/**
 * Merging a language switch back into a lesson in progress.
 *
 * Translating a lesson fans out one request per remaining section and can take
 * half a minute end to end — long enough for the lesson underneath to have
 * moved on. The merge is therefore written against the sections as they stand
 * when the results arrive, not against the snapshot taken when the switch
 * started, so a slow batch cannot revert something newer.
 */

export interface TranslatedSection {
  /** Absolute index in the lesson's section list. */
  index: number;
  /** The translated section, or null when that one request failed. */
  section: LessonSection | null;
  /** The API's own explanation, when it gave one. */
  error?: string;
}

export function applyTranslations(
  current: readonly LessonSection[],
  results: readonly TranslatedSection[]
): LessonSection[] {
  const next = [...current];
  let changed = false;
  for (const result of results) {
    if (!result.section) continue;
    // A result addressed outside the lesson is dropped rather than appended:
    // it belongs to a lesson that has since changed shape.
    if (!Number.isInteger(result.index) || result.index < 0 || result.index >= next.length) continue;
    next[result.index] = result.section;
    changed = true;
  }
  return changed ? next : [...current];
}

/**
 * What to tell the learner about sections that stayed in the original
 * language, or null when every one of them was translated.
 */
export function translationFailure(results: readonly TranslatedSection[]): string | null {
  const failures = results.filter((r) => !r.section);
  if (failures.length === 0) return null;
  // Surface the API's own explanation (quota, rate limit) rather than only a
  // count, so the learner knows whether retrying will help.
  const reason = failures.find((f) => f.error)?.error;
  return (
    `${failures.length} of ${results.length} sections stayed in the original language.` +
    (reason ? ` ${reason}` : "")
  );
}
