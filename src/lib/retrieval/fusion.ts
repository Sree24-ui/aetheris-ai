/**
 * Combining the two halves of hybrid retrieval (M5).
 *
 * Retrieval was vector similarity alone, with no threshold, no lexical arm and
 * no diversity control — so a document with nothing relevant in it still
 * returned its ten least-irrelevant chunks and the lesson was "grounded" in
 * them, and ten chunks of the same slide could crowd out the rest of the
 * material.
 *
 * Kept separate from the database access so the ranking rules can be tested
 * as arithmetic.
 */

export interface Candidate {
  chunkId: string;
  text: string;
  /** Where in the document it came from, when the chunker could tell. */
  source?: string;
}

export interface RankedPassage extends Candidate {
  /** Fused relevance in [0, 1]. Not comparable across queries. */
  score: number;
}

/**
 * Reciprocal rank fusion.
 *
 * Rank-based rather than score-based on purpose: a cosine similarity and a
 * `ts_rank` are numbers on entirely different scales, and any attempt to
 * weight them directly bakes in an arbitrary calibration that drifts the
 * moment either side changes. RRF only needs each arm's ordering.
 *
 * `k` damps the advantage of the very top ranks; 60 is the value from the
 * original paper and behaves well without tuning.
 */
export const RRF_K = 60;

export function fuseRankings(
  arms: Candidate[][],
  options: { k?: number } = {}
): RankedPassage[] {
  const k = options.k ?? RRF_K;
  const scores = new Map<string, { candidate: Candidate; score: number }>();

  for (const arm of arms) {
    arm.forEach((candidate, rank) => {
      const contribution = 1 / (k + rank + 1);
      const existing = scores.get(candidate.chunkId);
      if (existing) {
        existing.score += contribution;
        // Prefer whichever arm carried provenance.
        if (!existing.candidate.source && candidate.source) existing.candidate = candidate;
      } else {
        scores.set(candidate.chunkId, { candidate, score: contribution });
      }
    });
  }

  // Normalised against the best possible score for the number of arms, so the
  // threshold below means something stable rather than shifting with the
  // result-set size.
  const best = arms.length / (k + 1);
  return [...scores.values()]
    .map(({ candidate, score }) => ({ ...candidate, score: best > 0 ? score / best : 0 }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Trims a ranking to what should actually be shown to the model.
 *
 * Applies, in order: a relevance floor, a cap on how many passages may come
 * from any single part of the document, and the overall limit.
 */
export function selectPassages(
  ranked: RankedPassage[],
  options: { topK: number; minScore: number; maxPerSource: number }
): RankedPassage[] {
  const perSource = new Map<string, number>();
  const chosen: RankedPassage[] = [];

  for (const passage of ranked) {
    if (chosen.length >= options.topK) break;
    if (passage.score < options.minScore) break; // ranked descending
    // Passages with no known source are not pooled together under one key —
    // that would make an unlabelled document return at most `maxPerSource`
    // passages in total.
    const key = passage.source ?? `__unlabelled__:${passage.chunkId}`;
    const used = perSource.get(key) ?? 0;
    if (passage.source && used >= options.maxPerSource) continue;
    perSource.set(key, used + 1);
    chosen.push(passage);
  }

  return chosen;
}

/**
 * Renders passages for a prompt, each labelled so the model can cite it and a
 * reader can trace a claim back to a place in the document.
 */
export function formatCitations(passages: RankedPassage[]): string {
  return passages
    .map((passage, i) => {
      const label = passage.source ? `${passage.source}, ` : "";
      return `[${i + 1}] (${label}passage ${passage.chunkId})\n${passage.text}`;
    })
    .join("\n\n");
}
