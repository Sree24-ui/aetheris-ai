import type { PoolClient } from "pg";
import { pool } from "./db";
import {
  PROMPT_VERSION,
  isLive,
  type LessonSource,
  type LessonSessionState,
} from "./lessonState";
import type { LearnerHistoryEntry, LearnerProfile, LessonPlan } from "./types";

/**
 * Persistence for lesson sessions.
 *
 * The interesting rules live in `lessonState.ts`; this file only reads and
 * writes them, plus the one thing that cannot be expressed as a pure
 * transition: committing a completed lesson — the session, the history row and
 * the learning-path advance — in a single transaction.
 */

/** Anything that can run a query: the pool, or a client inside a transaction. */
type Queryable = Pick<PoolClient, "query">;

interface SessionRow {
  id: string;
  status: LessonSessionState["status"];
  topic: string;
  language: string;
  profile: LearnerProfile;
  plan: LessonPlan;
  path_topic: string | null;
  path_step_index: number | null;
  current_section_index: number;
  checkpoint_results: LessonSessionState["checkpointResults"];
  transcript: LessonSessionState["transcript"];
  quiz_id: string | null;
  sources: LessonSource[];
  version: number;
}

const SELECT_COLUMNS = `id, status, topic, language, profile, plan, path_topic, path_step_index,
  current_section_index, checkpoint_results, transcript, quiz_id, sources, version`;

function rowToState(row: SessionRow): LessonSessionState {
  return {
    id: row.id,
    status: row.status,
    topic: row.topic,
    language: row.language,
    profile: row.profile,
    plan: row.plan,
    pathTopic: row.path_topic,
    pathStepIndex: row.path_step_index,
    currentSectionIndex: row.current_section_index,
    checkpointResults: row.checkpoint_results ?? [],
    transcript: row.transcript ?? [],
    quizId: row.quiz_id,
    sources: row.sources ?? [],
    version: row.version,
  };
}

export interface NewSession {
  id: string;
  topic: string;
  language: string;
  profile: LearnerProfile;
  plan: LessonPlan;
  sources?: LessonSource[];
  pathTopic?: string | null;
  pathStepIndex?: number | null;
}

/**
 * Starts a lesson, superseding whatever was in flight.
 *
 * A partial unique index allows only one live session per learner, so
 * cancelling the previous one is part of the same transaction as creating the
 * new one — otherwise starting a second lesson would fail on the index, or
 * two tabs would each believe they owned the lesson.
 */
export async function createSession(
  session: NewSession,
  userId: number
): Promise<LessonSessionState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE lesson_sessions SET status = 'cancelled', updated_at = now()
        WHERE user_id = $1 AND status IN ('active', 'paused')`,
      [userId]
    );
    const { rows } = await client.query<SessionRow>(
      `INSERT INTO lesson_sessions
         (id, user_id, status, topic, language, profile, plan, sources,
          path_topic, path_step_index, prompt_version)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${SELECT_COLUMNS}`,
      [
        session.id,
        userId,
        session.topic,
        session.language,
        JSON.stringify(session.profile),
        JSON.stringify(session.plan),
        JSON.stringify(session.sources ?? []),
        session.pathTopic ?? null,
        session.pathStepIndex ?? null,
        PROMPT_VERSION,
      ]
    );
    await client.query("COMMIT");
    return rowToState(rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** The lesson this learner has in flight, if any. */
export async function loadActiveSession(userId: number): Promise<LessonSessionState | null> {
  const { rows } = await pool.query<SessionRow>(
    `SELECT ${SELECT_COLUMNS} FROM lesson_sessions
      WHERE user_id = $1 AND status IN ('active', 'paused')
      ORDER BY updated_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows[0] ? rowToState(rows[0]) : null;
}

export async function loadSession(
  sessionId: string,
  userId: number,
  db: Queryable = pool
): Promise<LessonSessionState | null> {
  const { rows } = await db.query<SessionRow>(
    `SELECT ${SELECT_COLUMNS} FROM lesson_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  return rows[0] ? rowToState(rows[0]) : null;
}

/**
 * Writes an accepted transition.
 *
 * The `version = $N` predicate is the same optimistic check the state machine
 * makes, repeated at the database so two requests that read the same version
 * concurrently cannot both write. Returns null when it lost that race, which
 * the caller reports as a stale version rather than as success.
 */
export async function saveSession(
  state: LessonSessionState,
  userId: number,
  previousVersion: number,
  db: Queryable = pool
): Promise<LessonSessionState | null> {
  const { rows } = await db.query<SessionRow>(
    `UPDATE lesson_sessions
        SET status = $3,
            current_section_index = $4,
            checkpoint_results = $5,
            transcript = $6,
            quiz_id = $7,
            version = $8,
            updated_at = now()
      WHERE id = $1 AND user_id = $2 AND version = $9
      RETURNING ${SELECT_COLUMNS}`,
    [
      state.id,
      userId,
      state.status,
      state.currentSectionIndex,
      JSON.stringify(state.checkpointResults),
      JSON.stringify(state.transcript),
      state.quizId,
      state.version,
      previousVersion,
    ]
  );
  return rows[0] ? rowToState(rows[0]) : null;
}

export interface CompletionOutcome {
  session: LessonSessionState;
  historyId: string;
  /** Where the learning path ended up, when this lesson belonged to one. */
  pathStepIndex: number | null;
  pathAdvanced: boolean;
  /** True when this exact completion had already been committed. */
  replayed: boolean;
}

/**
 * Commits a finished lesson in one transaction.
 *
 * Completion used to be three independent requests — write history, reload
 * memory, advance the path — any of which could fail on its own, leaving
 * progress in a state nobody could reconstruct: a lesson in the history with
 * the path not advanced, or the reverse. All three now commit together or not
 * at all.
 *
 * It is also idempotent end to end. The session's status is the record of
 * whether this lesson was already committed, and the history row is written
 * `ON CONFLICT DO NOTHING` against an id the client reuses across retries, so
 * a retry after a dropped response reports what happened rather than writing
 * a second copy.
 */
export async function completeLesson(
  params: {
    sessionId: string;
    expectedVersion: number;
    quizId: string;
    history: LearnerHistoryEntry;
  },
  userId: number
): Promise<CompletionOutcome | { conflict: "stale-version" | "not-found" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Locked for the length of the transaction so a concurrent completion
    // waits here rather than interleaving with this one.
    const { rows: locked } = await client.query<SessionRow>(
      `SELECT ${SELECT_COLUMNS} FROM lesson_sessions
        WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [params.sessionId, userId]
    );
    if (!locked[0]) {
      await client.query("ROLLBACK");
      return { conflict: "not-found" };
    }
    const state = rowToState(locked[0]);

    if (state.status === "completed") {
      await client.query("COMMIT");
      return {
        session: state,
        historyId: params.history.id,
        pathStepIndex: state.pathStepIndex,
        pathAdvanced: false,
        replayed: true,
      };
    }
    if (!isLive(state.status)) {
      await client.query("ROLLBACK");
      return { conflict: "not-found" };
    }
    if (state.version !== params.expectedVersion) {
      await client.query("ROLLBACK");
      return { conflict: "stale-version" };
    }

    await client.query(
      `INSERT INTO learner_history_entries
         (id, user_id, topic, occurred_at, language, subject, score_percent,
          strong_areas, weak_areas, recommendation, transcript, quiz)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
      [
        params.history.id,
        userId,
        params.history.topic,
        params.history.date,
        params.history.language ?? null,
        params.history.subject ?? null,
        params.history.scorePercent ?? null,
        JSON.stringify(params.history.strongAreas ?? []),
        JSON.stringify(params.history.weakAreas ?? []),
        params.history.recommendation ?? null,
        JSON.stringify(params.history.transcript ?? []),
        JSON.stringify(params.history.quiz ?? []),
      ]
    );

    // Only a lesson that belongs to a path step moves that path, and only
    // from the step it belongs to.
    let pathStepIndex = state.pathStepIndex;
    let pathAdvanced = false;
    if (state.pathStepIndex !== null) {
      const { rows: advanced } = await client.query<{ current_step_index: number }>(
        `UPDATE learner_learning_path
            SET current_step_index = LEAST(
                  $2::int + 1,
                  GREATEST(jsonb_array_length(path -> 'steps') - 1, 0)
                ),
                updated_at = now()
          WHERE user_id = $1 AND current_step_index = $2::int
          RETURNING current_step_index`,
        [userId, state.pathStepIndex]
      );
      if (advanced[0]) {
        pathStepIndex = advanced[0].current_step_index;
        pathAdvanced = true;
      }
    }

    const { rows: finished } = await client.query<SessionRow>(
      `UPDATE lesson_sessions
          SET status = 'completed', quiz_id = $3, version = version + 1, updated_at = now()
        WHERE id = $1 AND user_id = $2
        RETURNING ${SELECT_COLUMNS}`,
      [params.sessionId, userId, params.quizId]
    );

    await client.query("COMMIT");
    return {
      session: rowToState(finished[0]),
      historyId: params.history.id,
      pathStepIndex,
      pathAdvanced,
      replayed: false,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
