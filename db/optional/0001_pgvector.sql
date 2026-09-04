-- OPTIONAL: move vector search into Postgres (M4).
--
-- NOT part of `npm run migrate`. It is here, outside db/migrations/, because
-- applying it is a decision about the database rather than about the
-- application: it requires the `vector` extension, which needs privileges the
-- app's role may not have and which not every managed Postgres offers on
-- every plan.
--
-- Why it is worth doing: similarity is currently computed in Node over one
-- document's chunks. That is a few hundred rows and perfectly fine per
-- document — but every chunk's full embedding crosses the wire on every
-- search, and it does not survive a shared corpus or cross-document
-- retrieval.
--
-- Before applying:
--   1. Confirm the extension is available:  SELECT * FROM pg_available_extensions WHERE name = 'vector';
--   2. Apply this file against staging first.
--   3. Backfill: the `embedding_vec` column starts NULL, and rows are filled
--      from the existing JSONB. The UPDATE below does that in one pass; on a
--      large corpus, batch it by document_id instead.
--   4. Only then switch the application over.
--
-- Rolling back is non-destructive to the JSONB column, which is deliberately
-- left in place:
--   DROP INDEX IF EXISTS document_chunks_embedding_vec_idx;
--   ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding_vec;

CREATE EXTENSION IF NOT EXISTS vector;

-- 384 dimensions matches Xenova/all-MiniLM-L6-v2. A different embedding model
-- has a different width, and the column type has to match it — which is the
-- same reason `embedding_model` is stored per row.
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding_vec vector(384);

-- Backfill from the JSONB that is already there. The cast goes through text
-- because pgvector parses its own literal format, which is what JSONB's array
-- rendering happens to produce.
UPDATE document_chunks
   SET embedding_vec = (embedding::text)::vector
 WHERE embedding_vec IS NULL;

-- HNSW over cosine distance. `vector_cosine_ops` matches the normalised
-- vectors the embedding pipeline produces, where cosine distance is
-- 1 - dot product.
CREATE INDEX IF NOT EXISTS document_chunks_embedding_vec_idx
  ON document_chunks USING hnsw (embedding_vec vector_cosine_ops);
