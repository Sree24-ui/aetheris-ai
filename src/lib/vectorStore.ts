import { pool } from "./db";
import { chunkText } from "./chunk";
import { embedTexts, embedText, cosineSimilarity } from "./embeddings";
import {
  CONCEPT_SAMPLE_CHARS,
  CONCEPT_SAMPLE_CHUNKS,
  DOCUMENT_PREVIEW_CHARS,
  RETRIEVAL_TOP_K,
} from "./appConfig";
import type { SourceChunkRef } from "./types";

// Documents live in Postgres, not on disk.
//
// The previous implementation wrote one JSON file per document, falling back
// to os.tmpdir() on serverless. That directory is per-instance and wiped
// between cold starts, so an upload handled by one Lambda was invisible to the
// instance that later planned the lesson — surfacing as an intermittent
// "Document not found" that is very hard to reproduce locally, where the
// project-relative .data/ directory always worked.
//
// Every read is additionally scoped by userId: a document id is a UUID, but a
// UUID is not an authorisation check.

interface StoredChunk {
  chunk_id: string;
  text: string;
  embedding: number[];
}

export async function ingestDocument(
  docId: string,
  userId: number,
  filename: string,
  text: string
): Promise<{ numChunks: number; preview: string; sample: string }> {
  const chunks = chunkText(text);
  const vectors = await embedTexts(chunks.map((c) => c.text));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO documents (id, user_id, filename, num_chunks)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET filename = EXCLUDED.filename,
                                      num_chunks = EXCLUDED.num_chunks`,
      [docId, userId, filename, chunks.length]
    );
    // Re-ingesting the same id replaces its chunks rather than appending.
    await client.query(`DELETE FROM document_chunks WHERE document_id = $1`, [docId]);

    // One multi-row INSERT instead of a statement per chunk: a 60-chunk PDF
    // would otherwise be 60 round trips to Neon.
    if (chunks.length > 0) {
      const values: unknown[] = [];
      const tuples = chunks.map((c, i) => {
        const base = i * 5;
        values.push(docId, c.id, c.index, c.text, JSON.stringify(vectors[i]));
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
      });
      await client.query(
        `INSERT INTO document_chunks (document_id, chunk_id, chunk_index, text, embedding)
         VALUES ${tuples.join(", ")}`,
        values
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const sample = chunks.slice(0, CONCEPT_SAMPLE_CHUNKS).map((c) => c.text).join("\n\n");
  return {
    numChunks: chunks.length,
    preview: chunks.slice(0, 2).map((c) => c.text).join(" ").slice(0, DOCUMENT_PREVIEW_CHARS),
    sample: sample.slice(0, CONCEPT_SAMPLE_CHARS),
  };
}

export async function searchDocument(
  docId: string,
  userId: number,
  query: string,
  topK = RETRIEVAL_TOP_K
): Promise<SourceChunkRef[]> {
  const { rows } = await pool.query<StoredChunk>(
    `SELECT c.chunk_id, c.text, c.embedding
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.document_id = $1 AND d.user_id = $2
      ORDER BY c.chunk_index`,
    [docId, userId]
  );
  if (rows.length === 0) return [];

  const queryVec = await embedText(query);
  const scored = rows.map((r) => ({
    chunkId: r.chunk_id,
    text: r.text,
    // JSONB comes back already parsed by `pg`, but a column written by an
    // older build could still be a string — normalise before scoring.
    score: cosineSimilarity(
      queryVec,
      Array.isArray(r.embedding) ? r.embedding : JSON.parse(r.embedding as unknown as string)
    ),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

export async function getFullDocumentText(docId: string, userId: number): Promise<string> {
  const { rows } = await pool.query<{ text: string }>(
    `SELECT c.text
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.document_id = $1 AND d.user_id = $2
      ORDER BY c.chunk_index`,
    [docId, userId]
  );
  return rows.map((r) => r.text).join("\n\n");
}

export async function documentExists(docId: string, userId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM documents WHERE id = $1 AND user_id = $2`,
    [docId, userId]
  );
  return rows.length > 0;
}
