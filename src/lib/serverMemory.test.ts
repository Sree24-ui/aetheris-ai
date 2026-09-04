import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveConceptMastery } from "./serverMemory";

/**
 * Regression tests for M1.
 *
 * The comment said "the most recent concept result wins". The code did not do
 * that: walking newest-first it deleted a concept from the weak set for every
 * entry that listed it as strong, including older ones, so a weakness recorded
 * in the latest lesson vanished because an earlier lesson had gone well.
 */

const entry = (strongAreas: string[], weakAreas: string[]) => ({ strongAreas, weakAreas });

test("a newer weakness is not erased by an older strength", () => {
  // Newest first: today it went badly, last week it went well.
  const { weakConcepts, strongConcepts } = deriveConceptMastery([
    entry([], ["integration by parts"]),
    entry(["integration by parts"], []),
  ]);
  assert.deepEqual(weakConcepts, ["integration by parts"]);
  assert.deepEqual(strongConcepts, []);
});

test("a newer strength does replace an older weakness", () => {
  const { weakConcepts, strongConcepts } = deriveConceptMastery([
    entry(["integration by parts"], []),
    entry([], ["integration by parts"]),
  ]);
  assert.deepEqual(strongConcepts, ["integration by parts"]);
  assert.deepEqual(weakConcepts, []);
});

test("only the most recent mention counts, however many follow it", () => {
  const { weakConcepts, strongConcepts } = deriveConceptMastery([
    entry([], ["limits"]),
    entry(["limits"], []),
    entry(["limits"], []),
    entry(["limits"], []),
  ]);
  assert.deepEqual(weakConcepts, ["limits"]);
  assert.deepEqual(strongConcepts, []);
});

test("a concept listed both ways in one lesson resolves to weak", () => {
  // Conservative on purpose: revisiting a concept the learner knows costs a
  // few minutes, dropping one they do not costs them the topic.
  const { weakConcepts, strongConcepts } = deriveConceptMastery([
    entry(["vectors"], ["vectors"]),
  ]);
  assert.deepEqual(weakConcepts, ["vectors"]);
  assert.deepEqual(strongConcepts, []);
});

test("concepts are independent of one another", () => {
  const { weakConcepts, strongConcepts } = deriveConceptMastery([
    entry(["derivatives"], ["limits"]),
    entry(["limits"], ["derivatives"]),
  ]);
  assert.deepEqual(strongConcepts, ["derivatives"]);
  assert.deepEqual(weakConcepts, ["limits"]);
});

test("empty and missing lists are handled", () => {
  assert.deepEqual(deriveConceptMastery([]), { strongConcepts: [], weakConcepts: [] });
  const result = deriveConceptMastery([{ strongAreas: ["a"] }, { weakAreas: ["b"] }]);
  assert.deepEqual(result.strongConcepts, ["a"]);
  assert.deepEqual(result.weakConcepts, ["b"]);
});

test("a concept is never reported as both strong and weak", () => {
  const history = [
    entry(["a", "b"], ["c"]),
    entry(["c"], ["a"]),
    entry(["b"], ["b"]),
  ];
  const { strongConcepts, weakConcepts } = deriveConceptMastery(history);
  for (const concept of strongConcepts) {
    assert.ok(!weakConcepts.includes(concept), `${concept} appears in both lists`);
  }
});
