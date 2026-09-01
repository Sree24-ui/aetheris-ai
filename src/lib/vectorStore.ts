import fs from "fs/promises";
import os from "os";
import path from "path";
import { chunkText } from "./chunk";
import { embedTexts, embedText, cosineSimilarity } from "./embeddings";
import type { SourceChunkRef } from "./types";

// Serverless platforms (e.g. Vercel) ship a read-only filesystem except for
// `/tmp` — writing under the project directory there throws EROFS. Locally
// (and on traditional Node hosts) keep using a project-relative folder so
// uploaded documents are easy to find during development.
const DATA_DIR =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(os.tmpdir(), "ai-teacher-documents")
    : path.join(process.cwd(), ".data", "documents");

interface StoredDoc {
  docId: string;
  filename: string;
  chunks: { id: string; text: string; vector: number[] }[];
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function filePath(docId: string) {
  return path.join(DATA_DIR, `${docId}.json`);
}

export async function ingestDocument(
  docId: string,
  filename: string,
  text: string
): Promise<{ numChunks: number; preview: string; sample: string }> {
  await ensureDir();
  const chunks = chunkText(text);
  const vectors = await embedTexts(chunks.map((c) => c.text));
  const stored: StoredDoc = {
    docId,
    filename,
    chunks: chunks.map((c, i) => ({ id: c.id, text: c.text, vector: vectors[i] })),
  };
  await fs.writeFile(filePath(docId), JSON.stringify(stored));
  const sample = chunks.slice(0, 5).map((c) => c.text).join("\n\n");
  return {
    numChunks: chunks.length,
    preview: chunks.slice(0, 2).map((c) => c.text).join(" ").slice(0, 400),
    sample: sample.slice(0, 4000),
  };
}

export async function searchDocument(
  docId: string,
  query: string,
  topK = 6
): Promise<SourceChunkRef[]> {
  const raw = await fs.readFile(filePath(docId), "utf-8");
  const doc: StoredDoc = JSON.parse(raw);
  const queryVec = await embedText(query);
  const scored = doc.chunks.map((c) => ({
    chunkId: c.id,
    text: c.text,
    score: cosineSimilarity(queryVec, c.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export async function getFullDocumentText(docId: string): Promise<string> {
  const raw = await fs.readFile(filePath(docId), "utf-8");
  const doc: StoredDoc = JSON.parse(raw);
  return doc.chunks.map((c) => c.text).join("\n\n");
}

export async function documentExists(docId: string): Promise<boolean> {
  try {
    await fs.access(filePath(docId));
    return true;
  } catch {
    return false;
  }
}
