import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTranslations, translationFailure, type TranslatedSection } from "./lessonTranslation";
import type { LessonSection } from "./types";

/**
 * Switching a lesson's language fans out one request per remaining section and
 * can take half a minute. The merge has to survive a lesson that moved on in
 * the meantime, and a switch that was superseded while it was in flight.
 */

const section = (id: string, narration: string): LessonSection => ({
  id,
  title: id,
  narration,
  bulletPoints: [],
  visual: { type: "none" },
  estimatedSeconds: 60,
  conceptTags: [],
});

const english = [section("a", "one"), section("b", "two"), section("c", "three")];

test("translated sections land at their own index", () => {
  const merged = applyTranslations(english, [
    { index: 1, section: section("b", "deux") },
    { index: 2, section: section("c", "trois") },
  ]);
  assert.deepEqual(
    merged.map((s) => s.narration),
    ["one", "deux", "trois"]
  );
});

test("sections before the current one are left alone", () => {
  // Only what has not been taught yet is translated; the transcript above
  // stays in the language it was taught in.
  const merged = applyTranslations(english, [{ index: 2, section: section("c", "trois") }]);
  assert.equal(merged[0].narration, "one");
  assert.equal(merged[1].narration, "two");
});

test("a failed section keeps its original text", () => {
  const merged = applyTranslations(english, [
    { index: 1, section: null, error: "Rate limit reached." },
    { index: 2, section: section("c", "trois") },
  ]);
  assert.equal(merged[1].narration, "two");
  assert.equal(merged[2].narration, "trois");
});

test("the lesson passed in is never mutated", () => {
  const merged = applyTranslations(english, [{ index: 0, section: section("a", "un") }]);
  assert.equal(english[0].narration, "one");
  assert.notEqual(merged, english);
});

test("a result addressed outside the lesson is dropped, not appended", () => {
  // A batch that predates a lesson changing shape must not grow it back.
  const merged = applyTranslations(english, [
    { index: 9, section: section("z", "zzz") },
    { index: -1, section: section("y", "yyy") },
  ]);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((s) => s.id),
    ["a", "b", "c"]
  );
});

test("a batch where everything failed leaves the lesson as it was", () => {
  const results: TranslatedSection[] = [
    { index: 0, section: null },
    { index: 1, section: null },
  ];
  assert.deepEqual(applyTranslations(english, results), english);
});

test("no failures means nothing to tell the learner", () => {
  assert.equal(translationFailure([{ index: 0, section: section("a", "un") }]), null);
  assert.equal(translationFailure([]), null);
});

test("failures are counted, and the API's own reason is passed through", () => {
  const message = translationFailure([
    { index: 0, section: section("a", "un") },
    { index: 1, section: null, error: "Daily model budget reached." },
    { index: 2, section: null },
  ]);
  assert.equal(
    message,
    "2 of 3 sections stayed in the original language. Daily model budget reached."
  );
});

test("a failure with no reason still says how many", () => {
  assert.equal(
    translationFailure([{ index: 0, section: null }]),
    "1 of 1 sections stayed in the original language."
  );
});
