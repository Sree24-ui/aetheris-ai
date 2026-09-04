import { pool } from "./db";

/**
 * Account lifecycle: export and deletion (M13).
 *
 * Both were absent. A learner could accumulate lesson history, uploaded
 * documents and graded assessments with no way to take any of it with them
 * and no way to remove it.
 */

export interface AccountExport {
  exportedAt: string;
  account: { name: string | null; email: string | null; createdAt: string };
  learningPath: unknown;
  history: unknown[];
  documents: unknown[];
  assessments: unknown[];
}

/**
 * Everything the account holds, as plain JSON.
 *
 * Chunk embeddings are excluded on purpose: they are derived, enormous, and
 * meaningless outside this application's embedding model. The text they were
 * computed from is included, which is the part that is actually the learner's.
 */
export async function exportAccount(userId: number): Promise<AccountExport> {
  const [account, history, path, documents, assessments] = await Promise.all([
    pool.query(`SELECT name, email, created_at FROM users WHERE id = $1`, [userId]),
    pool.query(
      `SELECT id, topic, occurred_at, language, subject, score_percent,
              strong_areas, weak_areas, recommendation, transcript, quiz
         FROM learner_history_entries WHERE user_id = $1 ORDER BY occurred_at`,
      [userId]
    ),
    pool.query(
      `SELECT path, current_step_index, updated_at FROM learner_learning_path WHERE user_id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT d.id, d.filename, d.num_chunks, d.created_at,
              (SELECT jsonb_agg(jsonb_build_object('chunkId', c.chunk_id, 'source', c.source, 'text', c.text)
                                ORDER BY c.chunk_index)
                 FROM document_chunks c WHERE c.document_id = d.id) AS chunks
         FROM documents d WHERE d.user_id = $1 ORDER BY d.created_at`,
      [userId]
    ),
    pool.query(
      `SELECT q.id, q.topic, q.language, q.created_at,
              a.results, a.score_percent, a.grader_version, a.rubric_version, a.graded_at
         FROM lesson_quizzes q
         LEFT JOIN lesson_quiz_attempts a ON a.quiz_id = q.id
        WHERE q.user_id = $1
        ORDER BY q.created_at`,
      [userId]
    ),
  ]);

  const user = account.rows[0];
  return {
    exportedAt: new Date().toISOString(),
    account: {
      name: user?.name ?? null,
      email: user?.email ?? null,
      createdAt: user?.created_at ?? "",
    },
    learningPath: path.rows[0] ?? null,
    history: history.rows,
    documents: documents.rows,
    assessments: assessments.rows,
  };
}

/**
 * Deletes the account and everything that hangs off it.
 *
 * `confirmEmail` must match the account's own address. The check is here, in
 * the same statement as the delete, rather than in the route: it is the last
 * thing standing between a mis-click and an irreversible loss, and it should
 * not depend on a caller remembering to make it.
 *
 * Returns false when nothing was deleted, which is either a wrong address or
 * an account that is already gone — both are the same answer to the caller.
 */
export async function deleteAccount(userId: number, confirmEmail: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM users WHERE id = $1 AND lower(email) = lower($2)`,
    [userId, confirmEmail.trim()]
  );
  return (result.rowCount ?? 0) > 0;
}
