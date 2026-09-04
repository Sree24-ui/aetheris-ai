import { test } from "node:test";
import assert from "node:assert/strict";
import { fuseRankings, formatCitations, selectPassages, type Candidate } from "./fusion";

/**
 * Regression tests for M5. Retrieval was vector similarity alone: no lexical
 * arm, no relevance floor, no diversity control. A document with nothing
 * relevant in it still returned its ten least-irrelevant chunks, and the
 * lesson was described to the model as "grounded" in them.
 */

const c = (chunkId: string, source?: string): Candidate => ({
  chunkId,
  text: `text of ${chunkId}`,
  source,
});

test("a passage both arms rank highly beats one only a single arm found", () => {
  const vector = [c("a"), c("b"), c("c")];
  const lexical = [c("c"), c("a"), c("d")];
  const fused = fuseRankings([vector, lexical]);
  assert.equal(fused[0].chunkId, "a", JSON.stringify(fused.map((f) => f.chunkId)));
});

test("a passage only one arm found is still considered", () => {
  const fused = fuseRankings([[c("a")], [c("z")]]);
  const ids = fused.map((f) => f.chunkId);
  assert.ok(ids.includes("z"), ids.join(","));
});

test("fused scores are normalised, descending, and bounded", () => {
  const fused = fuseRankings([[c("a"), c("b")], [c("a"), c("b")]]);
  assert.equal(fused[0].score, 1, "a passage top of both arms should score 1");
  for (const passage of fused) {
    assert.ok(passage.score > 0 && passage.score <= 1, String(passage.score));
  }
  for (let i = 1; i < fused.length; i++) {
    assert.ok(fused[i - 1].score >= fused[i].score, "not sorted descending");
  }
});

test("provenance survives fusion even when only one arm carried it", () => {
  const fused = fuseRankings([[c("a")], [c("a", "Slide 3")]]);
  assert.equal(fused[0].source, "Slide 3");
});

test("an empty arm contributes nothing and breaks nothing", () => {
  const fused = fuseRankings([[], [c("a")]]);
  assert.equal(fused.length, 1);
  assert.deepEqual(fuseRankings([[], []]), []);
});

// --- Selection -----------------------------------------------------------

const ranked = (entries: [string, number, string?][]) =>
  entries.map(([chunkId, score, source]) => ({
    chunkId,
    text: `text of ${chunkId}`,
    source,
    score,
  }));

test("passages below the relevance floor are dropped, not returned anyway", () => {
  const chosen = selectPassages(ranked([["a", 0.9], ["b", 0.5], ["c", 0.01]]), {
    topK: 10,
    minScore: 0.1,
    maxPerSource: 5,
  });
  assert.deepEqual(chosen.map((p) => p.chunkId), ["a", "b"]);
});

test("a document with nothing relevant returns nothing at all", () => {
  // The important case: the lesson then says so rather than being "grounded"
  // in the least-irrelevant chunks of an unrelated document.
  const chosen = selectPassages(ranked([["a", 0.01], ["b", 0.005]]), {
    topK: 10,
    minScore: 0.1,
    maxPerSource: 5,
  });
  assert.deepEqual(chosen, []);
});

test("one part of the document cannot crowd out the rest", () => {
  const chosen = selectPassages(
    ranked([
      ["a", 0.9, "Slide 1"],
      ["b", 0.8, "Slide 1"],
      ["c", 0.7, "Slide 1"],
      ["d", 0.6, "Slide 2"],
    ]),
    { topK: 4, minScore: 0, maxPerSource: 2 }
  );
  assert.deepEqual(chosen.map((p) => p.chunkId), ["a", "b", "d"]);
});

test("unlabelled passages are not pooled under one source cap", () => {
  // Pooling them would make a document with no slide or heading markers
  // return at most `maxPerSource` passages in total.
  const chosen = selectPassages(ranked([["a", 0.9], ["b", 0.8], ["c", 0.7], ["d", 0.6]]), {
    topK: 4,
    minScore: 0,
    maxPerSource: 1,
  });
  assert.equal(chosen.length, 4);
});

test("the overall limit is respected", () => {
  const chosen = selectPassages(
    ranked([["a", 0.9], ["b", 0.8], ["c", 0.7]]),
    { topK: 2, minScore: 0, maxPerSource: 10 }
  );
  assert.equal(chosen.length, 2);
});

// --- Citations -----------------------------------------------------------

test("each passage is labelled so a claim can be traced back", () => {
  const rendered = formatCitations(
    ranked([["c3", 0.9, "Slide 2"], ["c9", 0.5]])
  );
  assert.match(rendered, /\[1\] \(Slide 2, passage c3\)/);
  assert.match(rendered, /\[2\] \(passage c9\)/);
  assert.ok(rendered.includes("text of c3"));
});

test("rendering no passages produces no text", () => {
  assert.equal(formatCitations([]), "");
});
