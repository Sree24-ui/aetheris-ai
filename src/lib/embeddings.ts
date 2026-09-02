import type { FeatureExtractionPipeline } from "@xenova/transformers";

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    const { pipeline, env } = await import("@xenova/transformers");
    env.allowLocalModels = false;
    pipelinePromise = pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    ) as unknown as Promise<FeatureExtractionPipeline>;
  }
  return pipelinePromise;
}

// Chunks are fed to the model in batches rather than one call per chunk.
// A 60-chunk PDF used to mean 60 sequential inference calls on upload; the
// batched form lets the runtime vectorize across the batch instead.
const EMBED_BATCH_SIZE = 16;

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

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
