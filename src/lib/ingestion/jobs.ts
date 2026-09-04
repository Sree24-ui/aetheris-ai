import { pool } from "./../db";
import { chunkText } from "./../chunk";
import { EMBEDDING_MODEL, embedTexts } from "./../embeddings";
import { extractConcepts } from "./../teachingAgent";
import {
  CONCEPT_SAMPLE_CHARS,
  CONCEPT_SAMPLE_CHUNKS,
  DOCUMENT_PREVIEW_CHARS,
  EMBED_BATCH_SIZE,
} from "./../appConfig";

/**
 * Document ingestion as a durable, resumable job (H11).
 *
 * Uploading used to extract, chunk, embed, write and run concept extraction
 * inside one 60-second request. A cold start, a large file or a slow provider
 * blew that budget and left the learner with no completion signal and a
 * half-written document.
 *
 * The work is now a row that advances in bounded slices. Each slice embeds a
 * few chunks, commits them, and moves the checkpoint — so a slice that dies
 * costs one slice, and the next one resumes from `next_chunk_index` rather
 * than starting over.
 *
 * ponytail: slices are driven by the client polling `/api/documents/jobs`
 * while it waits, because a real queue and its worker are an infrastructure
 * decision this project has not made. The job semantics — checkpoints,
 * attempt limits, heartbeats, observable states — are the part that matters
 * and are already here; swapping the trigger for a queue consumer touches
 * only `runSlice`'s caller. See docs/REMEDIATION-LEDGER.md (H11).
 */

/** Chunks embedded per slice. Small enough to finish well inside a request. */
export const CHUNKS_PER_SLICE = Math.max(EMBED_BATCH_SIZE, 8);
/** A job whose heartbeat is older than this is considered abandoned. */
export const STALE_JOB_MS = 90_000;

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export interface IngestionJob {
  id: string;
  documentId: string;
  status: JobStatus;
  totalChunks: number;
  nextChunkIndex: number;
  conceptsDone: boolean;
  attempts: number;
  maxAttempts: number;
  error: string | null;
}

interface JobRow {
  id: string;
  document_id: string;
  status: JobStatus;
  total_chunks: number;
  next_chunk_index: number;
  concepts_done: boolean;
  attempts: number;
  max_attempts: number;
  error: string | null;
}

const JOB_COLUMNS = `id, document_id, status, total_chunks, next_chunk_index,
  concepts_done, attempts, max_attempts, error`;

function rowToJob(row: JobRow): IngestionJob {
  return {
    id: row.id,
    documentId: row.document_id,
    status: row.status,
    totalChunks: row.total_chunks,
    nextChunkIndex: row.next_chunk_index,
    conceptsDone: row.concepts_done,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    error: row.error,
  };
}

/** Progress as a fraction, for a progress bar that means something. */
export function jobProgress(job: IngestionJob): number {
  if (job.status === "succeeded") return 1;
  if (job.totalChunks === 0) return 0;
  return Math.min(1, job.nextChunkIndex / job.totalChunks);
}

/**
 * Registers an upload and queues its ingestion.
 *
 * The document row and the job are written together: a document with no job
 * would sit at "pending" forever, and a job with no document would have
 * nothing to write chunks against.
 */
export async function enqueueIngestion(params: {
  jobId: string;
  documentId: string;
  userId: number;
  filename: string;
  text: string;
}): Promise<IngestionJob> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO documents (id, user_id, filename, num_chunks, ingest_status, preview)
       VALUES ($1, $2, $3, 0, 'pending', $4)
       ON CONFLICT (id) DO UPDATE
         SET filename = EXCLUDED.filename,
             ingest_status = 'pending',
             preview = EXCLUDED.preview`,
      [
        params.documentId,
        params.userId,
        params.filename,
        params.text.slice(0, DOCUMENT_PREVIEW_CHARS),
      ]
    );
    const { rows } = await client.query<JobRow>(
      `INSERT INTO ingestion_jobs (id, user_id, document_id, status, extracted_text)
       VALUES ($1, $2, $3, 'queued', $4)
       ON CONFLICT (document_id) DO UPDATE
         SET status = 'queued', next_chunk_index = 0, concepts_done = false,
             attempts = 0, error = NULL, updated_at = now()
       RETURNING ${JOB_COLUMNS}`,
      [params.jobId, params.userId, params.documentId, params.text]
    );
    await client.query("COMMIT");
    return rowToJob(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function loadJob(jobId: string, userId: number): Promise<IngestionJob | null> {
  const { rows } = await pool.query<JobRow>(
    `SELECT ${JOB_COLUMNS} FROM ingestion_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );
  return rows[0] ? rowToJob(rows[0]) : null;
}

/**
 * Claims a job for one slice of work.
 *
 * The `heartbeat_at` predicate is what makes an abandoned job recoverable: a
 * slice that died mid-flight leaves the row as 'running', and after
 * STALE_JOB_MS another caller may take it over. Without it, one killed
 * function would strand a document permanently.
 */
async function claimJob(jobId: string, userId: number): Promise<{ job: IngestionJob; text: string } | null> {
  const { rows } = await pool.query<JobRow & { extracted_text: string }>(
    `UPDATE ingestion_jobs
        SET status = 'running',
            attempts = attempts + 1,
            heartbeat_at = now(),
            updated_at = now()
      WHERE id = $1
        AND user_id = $2
        AND status IN ('queued', 'running')
        AND attempts < max_attempts
        AND (heartbeat_at IS NULL OR heartbeat_at < now() - make_interval(secs => $3))
      RETURNING ${JOB_COLUMNS}, extracted_text`,
    [jobId, userId, STALE_JOB_MS / 1000]
  );
  const row = rows[0];
  return row ? { job: rowToJob(row), text: row.extracted_text } : null;
}

/**
 * Advances a job by one slice.
 *
 * Returns the job as it now stands. A caller polls until `status` leaves
 * 'queued'/'running'. Doing nothing — because another slice holds the job, or
 * because it is already finished — is a normal outcome, not an error.
 */
export async function runSlice(jobId: string, userId: number): Promise<IngestionJob | null> {
  const claimed = await claimJob(jobId, userId);
  if (!claimed) return loadJob(jobId, userId);

  const { job, text } = claimed;
  try {
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await failJob(jobId, "No readable text could be indexed from that document.");
      return loadJob(jobId, userId);
    }

    if (job.totalChunks !== chunks.length) {
      await pool.query(
        `UPDATE ingestion_jobs SET total_chunks = $2, updated_at = now() WHERE id = $1`,
        [jobId, chunks.length]
      );
    }

    const from = job.nextChunkIndex;
    const slice = chunks.slice(from, from + CHUNKS_PER_SLICE);

    if (slice.length > 0) {
      const vectors = await embedTexts(slice.map((c) => c.text));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const values: unknown[] = [];
        const tuples = slice.map((c, i) => {
          const base = i * 7;
          values.push(
            job.documentId,
            c.id,
            c.index,
            c.text,
            JSON.stringify(vectors[i]),
            c.source ?? null,
            EMBEDDING_MODEL
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
        });
        // A re-run of the same slice overwrites its own rows rather than
        // failing on the primary key, so a retry after a lost response is
        // safe.
        await client.query(
          `INSERT INTO document_chunks
             (document_id, chunk_id, chunk_index, text, embedding, source, embedding_model)
           VALUES ${tuples.join(", ")}
           ON CONFLICT (document_id, chunk_id) DO UPDATE
             SET text = EXCLUDED.text,
                 chunk_index = EXCLUDED.chunk_index,
                 embedding = EXCLUDED.embedding,
                 source = EXCLUDED.source,
                 embedding_model = EXCLUDED.embedding_model`,
          values
        );
        // The checkpoint moves in the same transaction as the rows it
        // describes, so the two cannot disagree.
        await client.query(
          `UPDATE ingestion_jobs
              SET next_chunk_index = $2, status = 'queued', heartbeat_at = NULL, updated_at = now()
            WHERE id = $1`,
          [jobId, from + slice.length]
        );
        await client.query(
          `UPDATE documents SET num_chunks = $2 WHERE id = $1`,
          [job.documentId, from + slice.length]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      return loadJob(jobId, userId);
    }

    // Every chunk is indexed. Concept extraction is the last step, and a
    // failure there must not fail the document — it is already usable.
    if (!job.conceptsDone) {
      let concepts: string[] = [];
      let warning: string | null = null;
      try {
        const sample = chunks
          .slice(0, CONCEPT_SAMPLE_CHUNKS)
          .map((c) => c.text)
          .join("\n\n")
          .slice(0, CONCEPT_SAMPLE_CHARS);
        concepts = await extractConcepts(sample);
      } catch (err) {
        console.warn(`[ingest ${jobId}] concept extraction failed`, err);
        warning = "Key concepts could not be extracted, but the document is indexed and usable.";
      }
      await pool.query(
        `UPDATE documents SET concepts = $2, preview = $3, ingest_status = 'ready' WHERE id = $1`,
        [
          job.documentId,
          JSON.stringify(concepts),
          chunks.slice(0, 2).map((c) => c.text).join(" ").slice(0, DOCUMENT_PREVIEW_CHARS),
        ]
      );
      await pool.query(
        `UPDATE ingestion_jobs
            SET concepts_done = true, status = 'succeeded', error = $2,
                heartbeat_at = NULL, updated_at = now()
          WHERE id = $1`,
        [jobId, warning]
      );
    }
    return loadJob(jobId, userId);
  } catch (err) {
    // The message is deliberately generic: a provider's own text can name
    // keys and endpoints, and this is shown to a learner.
    console.error(`[ingest ${jobId}] slice failed`, err);
    await pool.query(
      `UPDATE ingestion_jobs
          SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
              error = $2,
              heartbeat_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [jobId, "Indexing that document did not finish. Try uploading it again."]
    );
    return loadJob(jobId, userId);
  }
}

async function failJob(jobId: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE ingestion_jobs
        SET status = 'failed', error = $2, heartbeat_at = NULL, updated_at = now()
      WHERE id = $1`,
    [jobId, message]
  );
}
