import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "./chunk";

/**
 * Regression tests for M3. Overlap was only applied when a single paragraph
 * was too long to fit, so at an ordinary paragraph boundary — where most
 * chunks actually end — the next chunk started cold and an idea spanning the
 * boundary was split between two passages that each retrieved badly.
 */

const paragraph = (word: string, times: number) => Array(times).fill(word).join(" ");

test("consecutive chunks overlap at an ordinary paragraph boundary", () => {
  const text = [paragraph("alpha", 40), paragraph("beta", 40), paragraph("gamma", 40)].join("\n\n");
  const chunks = chunkText(text, 300, 60);
  assert.ok(chunks.length >= 2, `expected several chunks, got ${chunks.length}`);

  for (let i = 1; i < chunks.length; i++) {
    const tail = chunks[i - 1].text.slice(-60);
    const head = chunks[i].text.slice(0, 60);
    // Some suffix of the previous chunk has to reappear at the head of this
    // one, or the boundary is a hard cut again.
    const shared = head.split(/\s+/).some((word) => word.length > 2 && tail.includes(word));
    assert.ok(shared, `no overlap between chunk ${i - 1} and ${i}`);
  }
});

test("the overlap never starts mid-word", () => {
  const text = [paragraph("photosynthesis", 30), paragraph("chlorophyll", 30)].join("\n\n");
  for (const chunk of chunkText(text, 300, 60)) {
    const firstWord = chunk.text.split(/\s+/)[0];
    assert.ok(
      ["photosynthesis", "chlorophyll"].includes(firstWord),
      `chunk starts mid-word: "${firstWord}"`
    );
  }
});

test("an oversized paragraph is windowed with overlap", () => {
  const chunks = chunkText(paragraph("x", 2000), 300, 60);
  assert.ok(chunks.length > 3);
  for (const chunk of chunks) assert.ok(chunk.text.length <= 300);
});

test("chunking always terminates, whatever the overlap", () => {
  // An overlap at or above the chunk size made the sliding window stop
  // advancing. The caller-supplied value is clamped rather than trusted.
  for (const overlap of [0, 100, 300, 900, 5000]) {
    const chunks = chunkText(paragraph("word", 500), 300, overlap);
    assert.ok(chunks.length > 0, `overlap ${overlap} produced nothing`);
    assert.ok(chunks.length < 500, `overlap ${overlap} produced ${chunks.length} chunks`);
  }
});

test("chunks are contiguous ids in reading order", () => {
  const chunks = chunkText(
    [paragraph("a", 40), paragraph("b", 40), paragraph("c", 40)].join("\n\n"),
    250,
    40
  );
  chunks.forEach((chunk, i) => {
    assert.equal(chunk.index, i);
    assert.equal(chunk.id, `c${i}`);
  });
});

test("no chunk exceeds the size limit", () => {
  const text = Array.from({ length: 20 }, (_, i) => paragraph(`p${i}`, 30)).join("\n\n");
  for (const chunk of chunkText(text, 400, 80)) {
    assert.ok(chunk.text.length <= 400 + 80, `chunk of ${chunk.text.length} chars`);
  }
});

// --- Source provenance ----------------------------------------------------

test("slide markers are carried onto the chunks under them", () => {
  const text = [
    "[Slide 1]\n" + paragraph("intro", 30),
    paragraph("more intro", 30),
    "[Slide 2]\n" + paragraph("second", 30),
  ].join("\n\n");
  const chunks = chunkText(text, 300, 40);
  assert.equal(chunks[0].source, "Slide 1");
  assert.equal(chunks[chunks.length - 1].source, "Slide 2");
});

test("markdown headings are used as a source label", () => {
  const text = ["# Photosynthesis", paragraph("light", 40), paragraph("dark", 40)].join("\n\n");
  const chunks = chunkText(text, 300, 40);
  assert.equal(chunks[0].source, "Photosynthesis");
});

test("text with no markers simply has no source", () => {
  const chunks = chunkText(paragraph("plain", 60), 300, 40);
  assert.equal(chunks[0].source, undefined);
});

// --- Degenerate input -----------------------------------------------------

test("empty and whitespace-only input produces nothing", () => {
  assert.deepEqual(chunkText(""), []);
  assert.deepEqual(chunkText("   \n\n  \t "), []);
});

test("input shorter than the minimum is dropped as noise", () => {
  assert.deepEqual(chunkText("12"), []);
});

test("windows line endings and runs of spaces are normalised", () => {
  const chunks = chunkText("Line one.\r\n\r\nLine    two is long enough to keep.", 300, 40);
  assert.ok(chunks.length >= 1);
  assert.ok(!chunks[0].text.includes("\r"));
  assert.ok(!chunks[0].text.includes("    "));
});
