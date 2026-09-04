import { pool } from "./db";
import { chunkText } from "./chunk";
import { embedTexts, embedText, cosineSimilarity, EMBEDDING_MODEL } from "./embeddings";
import {
  CONCEPT_SAMPLE_CHARS,
  CONCEPT_SAMPLE_CHUNKS,
  DOCUMENT_PREVIEW_CHARS,
  RETRIEVAL_CANDIDATES,
  RETRIEVAL_MAX_PER_SOURCE,
  RETRIEVAL_MIN_SCORE,
  RETRIEVAL_TOP_K,
} from "./appConfig";
import { fuseRankings, selectPassages, type Candidate } from "./retrieval/fusion";
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
  source: string | null;
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
        const base = i * 7;
        // The embedding model is stored with the vector: two models' vectors
        // are not comparable, and retrieval filters on this.
        values.push(
          docId,
          c.id,
          c.index,
          c.text,
          JSON.stringify(vectors[i]),
          c.source ?? null,
          EMBEDDING_MODEL
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
      });
      await client.query(
        `INSERT INTO document_chunks
           (document_id, chunk_id, chunk_index, text, embedding, source, embedding_model)
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

/**
 * Finds the passages of a document most relevant to a query (M4, M5, M6).
 *
 * Hybrid: a lexical arm in Postgres and a vector arm in Node, fused by
 * reciprocal rank. The lexical arm matters more than it looks — it is what
 * finds an exact term, a name or a number that an embedding smooths away, and
 * it is the arm that still works when the embedding model has changed and the
 * old vectors no longer apply.
 *
 * ponytail: the vector arm is still an O(n) scan over one document's chunks in
 * Node, which is fine for the few hundred rows a document produces and is not
 * fine for a shared corpus. `db/optional/0001_pgvector.sql` is the upgrade,
 * and it needs a decision about the database extension before it can be
 * applied — see docs/REMEDIATION-LEDGER.md (M4).
 */
export async function searchDocument(
  docId: string,
  userId: number,
  query: string,
  topK = RETRIEVAL_TOP_K
): Promise<SourceChunkRef[]> {
  const [lexical, vector] = await Promise.all([
    lexicalCandidates(docId, userId, query),
    vectorCandidates(docId, userId, query),
  ]);

  const fused = fuseRankings([vector, lexical]);
  return selectPassages(fused, {
    topK,
    minScore: RETRIEVAL_MIN_SCORE,
    maxPerSource: RETRIEVAL_MAX_PER_SOURCE,
  }).map((passage) => ({
    chunkId: passage.chunkId,
    text: passage.text,
    score: passage.score,
    source: passage.source,
  }));
}

/** Full-text candidates, ranked by Postgres. */
async function lexicalCandidates(
  docId: string,
  userId: number,
  query: string
): Promise<Candidate[]> {
  // 'simple' rather than 'english': English stemming and stop words would
  // actively harm the other 21 languages this product teaches in.
  const { rows } = await pool.query<{ chunk_id: string; text: string; source: string | null }>(
    `SELECT c.chunk_id, c.text, c.source
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.document_id = $1
        AND d.user_id = $2
        AND to_tsvector('simple', c.text) @@ websearch_to_tsquery('simple', $3)
      ORDER BY ts_rank(to_tsvector('simple', c.text), websearch_to_tsquery('simple', $3)) DESC
      LIMIT $4`,
    [docId, userId, query, RETRIEVAL_CANDIDATES]
  );
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    text: row.text,
    source: row.source ?? undefined,
  }));
}

/** Embedding candidates, scored in Node over this document's chunks. */
async function vectorCandidates(
  docId: string,
  userId: number,
  query: string
): Promise<Candidate[]> {
  const { rows } = await pool.query<StoredChunk>(
    `SELECT c.chunk_id, c.text, c.source, c.embedding
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.document_id = $1
        AND d.user_id = $2
        -- Vectors from a different model are not comparable with this one.
        -- NULL covers rows written before the column existed, whose vectors
        -- came from the model that was the default at the time.
        AND (c.embedding_model = $3 OR c.embedding_model IS NULL)
      ORDER BY c.chunk_index`,
    [docId, userId, EMBEDDING_MODEL]
  );
  if (rows.length === 0) return [];

  const queryVec = await embedText(query);
  const scored: (Candidate & { similarity: number })[] = rows.map((r) => ({
    chunkId: r.chunk_id,
    text: r.text,
    source: r.source ?? undefined,
    // JSONB comes back already parsed by `pg`, but a column written by an
    // older build could still be a string — normalise before scoring.
    similarity: cosineSimilarity(
      queryVec,
      Array.isArray(r.embedding) ? r.embedding : JSON.parse(r.embedding as unknown as string)
    ),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, RETRIEVAL_CANDIDATES);
}

export interface DocumentRecord {
  docId: string;
  filename: string;
  numChunks: number;
  uploadedAt: string;
}

/** Every document this learner has uploaded, newest first. */
export async function listDocumentsForUser(userId: number): Promise<DocumentRecord[]> {
  const { rows } = await pool.query<{
    id: string;
    filename: string;
    num_chunks: number;
    created_at: string;
  }>(
    `SELECT id, filename, num_chunks, created_at
       FROM documents
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 200`,
    [userId]
  );
  return rows.map((row) => ({
    docId: row.id,
    filename: row.filename,
    numChunks: row.num_chunks,
    uploadedAt: row.created_at,
  }));
}

/**
 * Deletes a document and everything derived from it (M10).
 *
 * Removing a file from the setup UI used to clear the local selection and
 * nothing else: the text, its chunks and its embeddings stayed in the
 * database indefinitely, with no way for a learner to get rid of material
 * they had uploaded. The chunks go with it through the foreign key's
 * ON DELETE CASCADE, so there is one statement and no orphans.
 *
 * Scoped by user_id: a document id is an identifier, not a permission.
 * Returns false when there was nothing of theirs to delete, which the route
 * turns into a 404 rather than a misleading success.
 */
export async function deleteDocumentForUser(docId: string, userId: number): Promise<boolean> {
  const result = await pool.query(`DELETE FROM documents WHERE id = $1 AND user_id = $2`, [
    docId,
    userId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function documentExists(docId: string, userId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM documents WHERE id = $1 AND user_id = $2`,
    [docId, userId]
  );
  return rows.length > 0;
}
