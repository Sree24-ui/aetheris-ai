import type { FeatureExtractionPipeline } from "@xenova/transformers";
import { EMBED_BATCH_SIZE } from "./appConfig";

/**
 * The embedding model, recorded with every vector it produces (M6).
 *
 * The default is English-oriented, while the product advertises teaching in
 * 22 languages — retrieval quality on a Tamil or Marathi document is
 * measurably worse than it should be. Switching to a multilingual model
 * (`Xenova/paraphrase-multilingual-MiniLM-L12-v2` is the drop-in candidate)
 * is a data migration, not a config change: every stored vector has to be
 * recomputed, because vectors from two different models cannot be compared.
 *
 * Until that decision is made, the model id is stored alongside each vector
 * and retrieval filters on it. A model change therefore degrades to "older
 * documents return nothing until re-embedded", which is visible and
 * correctable, instead of to confident nonsense.
 */
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowLocalModels = false;
    pipelinePromise = pipeline(
      "feature-extraction",
      EMBEDDING_MODEL
    ) as unknown as Promise<FeatureExtractionPipeline>;
  }
  return pipelinePromise;
}

// Chunks are fed to the model in batches rather than one call per chunk.
// A 60-chunk PDF used to mean 60 sequential inference calls on upload; the
// batched form lets the runtime vectorize across the batch instead.

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getPipeline();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    // A batched call returns a [batch, dim] tensor flattened into one array,
    // so slice it back apart per input instead of assuming one vector.
    const dim = output.data.length / batch.length;
    const flat = output.data as Float32Array;
    for (let b = 0; b < batch.length; b++) {
      results.push(Array.from(flat.slice(b * dim, (b + 1) * dim)));
    }
  }
  return results;
}

export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec;
}

/**
 * Cosine similarity for two normalised vectors, which is their dot product.
 *
 * Returns 0 for vectors of different lengths rather than silently comparing
 * the overlapping prefix — that only happens when two different models'
 * output meet, and a partial dot product would be a meaningless number
 * presented as a relevance score.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
