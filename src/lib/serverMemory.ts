import { pool } from "./db";
import type { LearnerMemory, LearnerHistoryEntry, LearningPath } from "./types";

interface HistoryRow {
  id: string;
  topic: string;
  occurred_at: string;
  language: string | null;
  subject: string | null;
  score_percent: number | null;
  strong_areas: string[];
  weak_areas: string[];
  recommendation: string | null;
  transcript: LearnerHistoryEntry["transcript"];
  quiz: LearnerHistoryEntry["quiz"];
}

function rowToEntry(row: HistoryRow): LearnerHistoryEntry {
  return {
    id: row.id,
    topic: row.topic,
    date: row.occurred_at,
    language: row.language ?? "",
    subject: row.subject ?? undefined,
    scorePercent: row.score_percent ?? undefined,
    strongAreas: row.strong_areas ?? [],
    weakAreas: row.weak_areas ?? [],
    recommendation: row.recommendation ?? undefined,
    transcript: row.transcript ?? [],
    quiz: row.quiz ?? [],
  };
}

export async function loadMemoryForUser(userId: number): Promise<LearnerMemory> {
  const { rows } = await pool.query<HistoryRow>(
    `SELECT id, topic, occurred_at, language, subject, score_percent,
            strong_areas, weak_areas, recommendation, transcript, quiz
     FROM learner_history_entries
     WHERE user_id = $1
     ORDER BY occurred_at DESC
     LIMIT 50`,
    [userId]
  );
  const history = rows.map(rowToEntry);

  // Derived, not stored: a concept counts as "strong" if the most recent
  // entry mentioning it called it strong, else "weak" if any entry called
  // it weak. Walking most-recent-first means the first mention wins, which
  // is what we want since `history` is already sorted newest-first.
  const weak = new Set<string>();
  const strong = new Set<string>();
  for (const entry of history) {
    for (const w of entry.weakAreas) {
      if (!strong.has(w)) weak.add(w);
    }
    for (const s of entry.strongAreas) {
      weak.delete(s);
      strong.add(s);
    }
  }

  const pathResult = await pool.query<{ path: LearningPath; current_step_index: number }>(
    `SELECT path, current_step_index FROM learner_learning_path WHERE user_id = $1`,
    [userId]
  );
  const pathRow = pathResult.rows[0];

  return {
    history,
    weakConcepts: Array.from(weak),
    strongConcepts: Array.from(strong),
    currentPath: pathRow?.path,
    currentStepIndex: pathRow?.current_step_index,
  };
}

export async function addHistoryEntryForUser(
  userId: number,
  entry: LearnerHistoryEntry
): Promise<void> {
  await pool.query(
    `INSERT INTO learner_history_entries
       (id, user_id, topic, occurred_at, language, subject, score_percent,
        strong_areas, weak_areas, recommendation, transcript, quiz)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      entry.id,
      userId,
      entry.topic,
      entry.date,
      entry.language ?? null,
      entry.subject ?? null,
      entry.scorePercent ?? null,
      JSON.stringify(entry.strongAreas ?? []),
      JSON.stringify(entry.weakAreas ?? []),
      entry.recommendation ?? null,
      JSON.stringify(entry.transcript ?? []),
      JSON.stringify(entry.quiz ?? []),
    ]
  );
}

export async function setCurrentPathForUser(
  userId: number,
  path: LearningPath,
  stepIndex: number
): Promise<void> {
  await pool.query(
    `INSERT INTO learner_learning_path (user_id, path, current_step_index)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET path = $2, current_step_index = $3, updated_at = now()`,
    [userId, JSON.stringify(path), stepIndex]
  );
}

export async function advancePathForUser(userId: number): Promise<void> {
  await pool.query(
    `UPDATE learner_learning_path
     SET current_step_index = LEAST(
       current_step_index + 1,
       jsonb_array_length(path -> 'steps')
     ),
     updated_at = now()
     WHERE user_id = $1`,
    [userId]
  );
}
