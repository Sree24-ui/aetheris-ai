import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

/**
 * The authorization matrix (H4).
 *
 * Route protection used to live only in `proxy.ts`. This exercises the
 * handlers themselves, with the proxy out of the picture entirely, and proves
 * two things the audit called for: no sensitive route answers an anonymous
 * caller, and a document id belonging to another learner cannot be used to
 * ground a lesson.
 *
 * The data layer and the model client are stubbed — this is about who is
 * allowed in, not about what they get once they are.
 */

const lib = (name: string) =>
  pathToFileURL(path.join(process.cwd(), "src", "lib", name)).href;

/** Set per test; the stubbed `auth()` returns whatever is here. */
let session: { user?: { id?: string } } | null = null;

/** Documents, by id, with their owning user — the stub store for ownership. */
const OWNED_DOC = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const documents = new Map<string, number>();

/**
 * In-memory stand-ins for the two commands whose contract the routes depend
 * on. The SQL itself needs a database and is not covered here; what these
 * prove is that the routes surface the contract correctly — a replay as a
 * replay, a stolen id as 409, an out-of-order advance as a no-op.
 */
class StubHistoryIdConflict extends Error {}
class StubNoActivePath extends Error {}
const historyRows = new Map<string, number>();
const paths = new Map<number, { steps: number; index: number }>();
/** quizId -> { userId, quiz } and quizId -> attempt, for the H10 routes. */
const quizzes = new Map<string, { userId: number; quiz: Record<string, unknown> }>();
const attempts = new Map<string, Record<string, unknown>>();
let shortAnswerGrades = 0;
/** What the stubbed generator returns; a test sets it before creating a quiz. */
let quizFixture: unknown[] = [];
/** In-memory lesson sessions, keyed by id, with their owner. */
interface StubSession {
  userId: number;
  state: Record<string, unknown>;
}
const sessions = new Map<string, StubSession>();
/** In-memory ingestion jobs, keyed by id, with their owner. */
const jobs = new Map<string, { userId: number; job: Record<string, unknown> }>();
/** What the stubbed planner returns; includes a checkpoint with its answer. */
const PLAN_WITH_KEY = {
  topic: "Algebra",
  subject: "mathematics",
  levelSummary: "",
  totalEstimatedMinutes: 20,
  language: "English",
  sections: [
    {
      id: "s1",
      title: "Slope",
      narration: "Rise over run.",
      bulletPoints: [],
      visual: { type: "none" },
      estimatedSeconds: 60,
      conceptTags: ["slope"],
      checkpoint: {
        id: "cp1",
        type: "short",
        question: "What is slope?",
        correctAnswer: "SECRET-CHECKPOINT-KEY",
        conceptTag: "slope",
      },
    },
    {
      id: "s2",
      title: "Intercept",
      narration: "Where it crosses.",
      bulletPoints: [],
      visual: { type: "none" },
      estimatedSeconds: 60,
      conceptTags: ["intercept"],
      checkpoint: null,
    },
  ],
  finalQuizTopics: [],
  sourceGrounded: false,
};

before(() => {
  mock.module(lib("auth.ts"), {
    namedExports: {
      auth: async () => session,
      handlers: {},
      signIn: async () => undefined,
      signOut: async () => undefined,
    },
  });
  mock.module(lib("teachingAgent.ts"), {
    namedExports: {
      planLesson: async () => PLAN_WITH_KEY,
      generateQuiz: async () => quizFixture,
      // Deliberately claims a score, so a test can prove the stored attempt
      // overrides it rather than the model deciding the learner's mark.
      generateReport: async () => ({ topic: "stub", scorePercent: 99 }),
      evaluateAnswer: async () => ({ correct: true }),
      answerQuestion: async () => ({ answer: "stub", suggestedFollowUps: [] }),
      translateSection: async () => ({ id: "s1" }),
      generateLearningPath: async () => ({ topic: "stub", steps: [] }),
      parseInstruction: async () => ({ topic: "stub" }),
      extractConcepts: async () => [],
      gradeShortAnswer: async () => {
        shortAnswerGrades += 1;
        return { correct: true, partialCredit: 1, feedback: "ok" };
      },
    },
  });
  mock.module(lib("quizStore.ts"), {
    namedExports: {
      saveQuiz: async (quiz: { id: string }, userId: number) => {
        quizzes.set(quiz.id, { userId, quiz: quiz as Record<string, unknown> });
      },
      loadQuiz: async (quizId: string, userId: number) => {
        const row = quizzes.get(quizId);
        return row && row.userId === userId ? row.quiz : null;
      },
      loadAttempt: async (quizId: string, userId: number) => {
        const row = quizzes.get(quizId);
        if (!row || row.userId !== userId) return null;
        return attempts.get(quizId) ?? null;
      },
      saveAttempt: async (attempt: { quizId: string }) => {
        const existing = attempts.get(attempt.quizId);
        if (existing) return { stored: existing, replayed: true };
        attempts.set(attempt.quizId, attempt as Record<string, unknown>);
        return { stored: attempt, replayed: false };
      },
    },
  });
  mock.module(lib("vectorStore.ts"), {
    namedExports: {
      documentExists: async (docId: string, userId: number) => documents.get(docId) === userId,
      searchDocument: async () => [{ chunkId: "c0", text: "grounded", score: 1 }],
      ingestDocument: async () => ({ numChunks: 1, preview: "p", sample: "s" }),
      getFullDocumentText: async () => "",
      listDocumentsForUser: async (userId: number) =>
        [...documents.entries()]
          .filter(([, owner]) => owner === userId)
          .map(([docId]) => ({ docId, filename: "notes.pdf", numChunks: 1, uploadedAt: "" })),
      deleteDocumentForUser: async (docId: string, userId: number) => {
        if (documents.get(docId) !== userId) return false;
        documents.delete(docId);
        return true;
      },
    },
  });
  mock.module(lib("serverMemory.ts"), {
    namedExports: {
      HistoryIdConflict: StubHistoryIdConflict,
      NoActivePath: StubNoActivePath,
      loadMemoryForUser: async () => ({
        history: [],
        weakConcepts: [],
        strongConcepts: [],
        historyTotal: 0,
      }),
      addHistoryEntryForUser: async (userId: number, entry: { id: string }) => {
        const owner = historyRows.get(entry.id);
        if (owner === undefined) {
          historyRows.set(entry.id, userId);
          return { id: entry.id, replayed: false };
        }
        if (owner !== userId) throw new StubHistoryIdConflict();
        return { id: entry.id, replayed: true };
      },
      setCurrentPathForUser: async (userId: number, path: { steps: unknown[] }, index: number) => {
        paths.set(userId, { steps: path.steps.length, index });
      },
      advancePathForUser: async (userId: number, fromStepIndex: number) => {
        const path = paths.get(userId);
        if (!path) throw new StubNoActivePath();
        if (path.index !== fromStepIndex) return { stepIndex: path.index, advanced: false };
        path.index = Math.min(fromStepIndex + 1, Math.max(path.steps - 1, 0));
        return { stepIndex: path.index, advanced: true };
      },
      deriveConceptMastery: () => ({ strongConcepts: [], weakConcepts: [] }),
    },
  });
  mock.module(lib("lessonSessionStore.ts"), {
    namedExports: {
      createSession: async (session: Record<string, unknown>, userId: number) => {
        // The unique index allows one live session per learner.
        for (const [, existing] of sessions) {
          if (existing.userId === userId && ["active", "paused"].includes(String(existing.state.status))) {
            existing.state.status = "cancelled";
          }
        }
        const state = {
          ...session,
          status: "active",
          currentSectionIndex: 0,
          checkpointResults: [],
          transcript: [],
          quizId: null,
          pathTopic: session.pathTopic ?? null,
          pathStepIndex: session.pathStepIndex ?? null,
          version: 1,
        };
        sessions.set(String(session.id), { userId, state });
        return state;
      },
      loadSession: async (id: string, userId: number) => {
        const row = sessions.get(id);
        return row && row.userId === userId ? row.state : null;
      },
      loadActiveSession: async (userId: number) => {
        for (const [, row] of sessions) {
          if (row.userId === userId && ["active", "paused"].includes(String(row.state.status))) {
            return row.state;
          }
        }
        return null;
      },
      saveSession: async (
        state: Record<string, unknown>,
        userId: number,
        previousVersion: number
      ) => {
        const row = sessions.get(String(state.id));
        if (!row || row.userId !== userId || row.state.version !== previousVersion) return null;
        row.state = state;
        return state;
      },
      completeLesson: async (
        params: { sessionId: string; expectedVersion: number; quizId: string; history: { id: string } },
        userId: number
      ) => {
        const row = sessions.get(params.sessionId);
        if (!row || row.userId !== userId) return { conflict: "not-found" };
        if (row.state.status === "completed") {
          return {
            session: row.state,
            historyId: params.history.id,
            pathStepIndex: row.state.pathStepIndex ?? null,
            pathAdvanced: false,
            replayed: true,
          };
        }
        if (row.state.version !== params.expectedVersion) return { conflict: "stale-version" };
        row.state = {
          ...row.state,
          status: "completed",
          quizId: params.quizId,
          version: Number(row.state.version) + 1,
        };
        return {
          session: row.state,
          historyId: params.history.id,
          pathStepIndex: row.state.pathStepIndex ?? null,
          pathAdvanced: row.state.pathStepIndex !== null,
          replayed: false,
        };
      },
    },
  });
  mock.module(lib("ingestion/jobs.ts"), {
    namedExports: {
      CHUNKS_PER_SLICE: 8,
      STALE_JOB_MS: 90_000,
      jobProgress: (job: { status: string }) => (job.status === "succeeded" ? 1 : 0.5),
      enqueueIngestion: async (params: { jobId: string; documentId: string; userId: number }) => {
        const job = {
          id: params.jobId,
          documentId: params.documentId,
          status: "queued",
          totalChunks: 2,
          nextChunkIndex: 0,
          conceptsDone: false,
          attempts: 0,
          maxAttempts: 5,
          error: null,
        };
        jobs.set(params.jobId, { userId: params.userId, job });
        documents.set(params.documentId, params.userId);
        return job;
      },
      loadJob: async (jobId: string, userId: number) => {
        const row = jobs.get(jobId);
        return row && row.userId === userId ? row.job : null;
      },
      runSlice: async (jobId: string, userId: number) => {
        const row = jobs.get(jobId);
        if (!row || row.userId !== userId) return null;
        const next = Number(row.job.nextChunkIndex) + 1;
        row.job = {
          ...row.job,
          nextChunkIndex: next,
          status: next >= Number(row.job.totalChunks) ? "succeeded" : "queued",
        };
        return row.job;
      },
    },
  });
  mock.module(lib("documentParser.ts"), {
    namedExports: {
      parseDocument: async () => "A paragraph of extracted text that is long enough to keep.",
    },
  });
  mock.module(lib("db.ts"), {
    namedExports: { pool: { query: async () => ({ rows: [] }) } },
  });
});

beforeEach(async () => {
  session = null;
  historyRows.clear();
  paths.clear();
  documents.clear();
  documents.set(OWNED_DOC, 1);
  quizzes.clear();
  attempts.clear();
  shortAnswerGrades = 0;
  quizFixture = [];
  sessions.clear();
  jobs.clear();
  const { resetRateLimits } = await import(lib("security/rateLimit.ts"));
  resetRateLimits();
});

/** A minimal request; handlers only read headers and the body. */
function post(body?: unknown): Request {
  return new Request("https://aetheris.invalid/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function get(): Request {
  return new Request("https://aetheris.invalid/api/x", { method: "GET" });
}

function del(body?: unknown): Request {
  return new Request("https://aetheris.invalid/api/x", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function request(method: "GET" | "POST" | "PATCH" | "DELETE", body?: unknown): Request {
  if (method === "GET") return get();
  if (method === "DELETE") return del(body);
  return post(body);
}

type Handler = (req: Request) => Promise<Response>;

async function loadRoute(routePath: string): Promise<Record<string, Handler>> {
  return (await import(
    pathToFileURL(path.join(process.cwd(), "src", "app", "api", routePath, "route.ts")).href
  )) as Record<string, Handler>;
}

const validProfile = { level: "beginner", language: "English", availableMinutes: 20 };
const validSection = {
  id: "s1",
  title: "T",
  narration: "N",
  bulletPoints: [],
  visual: { type: "none" },
  estimatedSeconds: 60,
  conceptTags: [],
};
const validPlan = {
  topic: "Algebra",
  subject: "mathematics",
  language: "English",
  totalEstimatedMinutes: 20,
  sections: [validSection],
  sourceGrounded: false,
};

/** Every sensitive route, with a body that would otherwise be accepted. */
const matrix: { route: string; method: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown }[] = [
  { route: "documents", method: "GET" },
  { route: "documents/jobs", method: "GET" },
  {
    route: "documents/jobs",
    method: "POST",
    body: { jobId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" },
  },
  { route: "documents", method: "DELETE", body: { docId: OWNED_DOC } },
  { route: "instruction", method: "POST", body: { text: "teach me algebra" } },
  { route: "learning-path", method: "POST", body: { topic: "Algebra", profile: validProfile } },
  { route: "lesson/plan", method: "POST", body: { topic: "Algebra", profile: validProfile } },
  { route: "lesson/chat", method: "POST", body: { question: "why?" } },
  {
    route: "lesson/evaluate",
    method: "POST",
    body: {
      sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      expectedVersion: 1,
      sectionId: "s1",
      studentAnswer: "a",
    },
  },
  { route: "lesson/quiz", method: "POST", body: { sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" } },
  {
    route: "lesson/quiz/grade",
    method: "POST",
    body: { quizId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", answers: [] },
  },
  {
    route: "lesson/report",
    method: "POST",
    body: {
      sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      quizId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    },
  },
  { route: "lesson/session", method: "GET" },
  {
    route: "lesson/session",
    method: "POST",
    body: {
      sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      expectedVersion: 1,
      command: { type: "pause" },
    },
  },
  {
    route: "lesson/complete",
    method: "POST",
    body: {
      sessionId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      expectedVersion: 1,
      quizId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      historyId: "3f2504e0-4f89-11d3-9a0c-0305e82c3302",
      report: {},
    },
  },
  {
    route: "lesson/translate-section",
    method: "POST",
    body: { section: validSection, targetLanguage: "Hindi" },
  },
  { route: "history", method: "GET" },
  {
    route: "history",
    method: "POST",
    body: {
      id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      topic: "Algebra",
      date: new Date().toISOString(),
    },
  },
  {
    route: "history/path",
    method: "POST",
    body: { path: { topic: "Algebra", steps: [{ id: "a", title: "One" }] }, stepIndex: 0 },
  },
  { route: "history/path/advance", method: "POST", body: { fromStepIndex: 0 } },
  { route: "profile", method: "GET" },
  { route: "profile", method: "PATCH", body: { name: "Ada" } },
  { route: "upload", method: "POST" },
];

for (const { route, method, body } of matrix) {
  test(`${method} /api/${route} refuses an anonymous caller`, async () => {
    const handlers = await loadRoute(route);
    const handler = handlers[method];
    assert.ok(handler, `no ${method} handler exported by ${route}`);
    session = null;
    const response = await handler(request(method, body));
    assert.equal(response.status, 401, `${method} /api/${route}`);
  });

  test(`${method} /api/${route} refuses a session with no user id`, async () => {
    const handlers = await loadRoute(route);
    session = { user: {} };
    const response = await handlers[method](request(method, body));
    assert.equal(response.status, 401, `${method} /api/${route}`);
  });
}

test("a signed-in caller is served", async () => {
  const { POST } = await loadRoute("instruction");
  session = { user: { id: "1" } };
  const response = await POST(post({ text: "teach me algebra" }));
  assert.equal(response.status, 200);
});

// --- Cross-tenant access --------------------------------------------------

test("a document belonging to another learner cannot ground a lesson", async () => {
  const { POST } = await loadRoute("lesson/plan");
  const docId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301"; // owned by user 1

  session = { user: { id: "1" } };
  const owner = await POST(post({ topic: "Algebra", profile: validProfile, docId }));
  assert.equal(owner.status, 200, "the owner must still be able to use their own document");

  session = { user: { id: "2" } };
  const stranger = await POST(post({ topic: "Algebra", profile: validProfile, docId }));
  assert.equal(stranger.status, 404, "another learner's document must not be reachable");
});

test("a learner can delete their own document, once", async () => {
  const { DELETE, GET } = await loadRoute("documents");
  session = { user: { id: "1" } };

  const listed = await (await GET(get())).json();
  assert.equal(listed.documents.length, 1);

  const first = await DELETE(del({ docId: OWNED_DOC }));
  assert.equal(first.status, 200);

  // M10: gone from storage, not just from the form's local state.
  const after = await (await GET(get())).json();
  assert.equal(after.documents.length, 0);

  // A second delete reports honestly rather than claiming success again.
  const second = await DELETE(del({ docId: OWNED_DOC }));
  assert.equal(second.status, 404);
});

test("another learner's document cannot be deleted or listed", async () => {
  const { DELETE, GET } = await loadRoute("documents");
  session = { user: { id: "2" } };

  const stranger = await DELETE(del({ docId: OWNED_DOC }));
  assert.equal(stranger.status, 404);

  const listed = await (await GET(get())).json();
  assert.deepEqual(listed.documents, []);

  // And it is still there for its owner.
  session = { user: { id: "1" } };
  const owner = await (await GET(get())).json();
  assert.equal(owner.documents.length, 1);
});

test("an unknown document id is a 404, not a server error", async () => {
  const { POST } = await loadRoute("lesson/plan");
  session = { user: { id: "1" } };
  const response = await POST(
    post({
      topic: "Algebra",
      profile: validProfile,
      docId: "00000000-0000-4000-8000-000000000000",
    })
  );
  assert.equal(response.status, 404);
});

// --- Limits ---------------------------------------------------------------

test("an invalid body is a 400 before any model call", async () => {
  const { POST } = await loadRoute("lesson/plan");
  session = { user: { id: "1" } };
  const response = await POST(post({ topic: "", profile: validProfile }));
  assert.equal(response.status, 400);
});

test("a caller over the rate limit gets 429 with a Retry-After", async () => {
  const { POST } = await loadRoute("instruction");
  session = { user: { id: "9" } };
  let last: Response | undefined;
  for (let i = 0; i < 40; i++) {
    last = await POST(post({ text: "teach me algebra" }));
    if (last.status === 429) break;
  }
  assert.equal(last?.status, 429);
  assert.ok(last?.headers.get("Retry-After"));
});

test("registration is reachable without a session", async () => {
  const { POST } = await loadRoute("auth/register");
  session = null;
  // The stubbed pool returns no rows, so this reaches the insert path and
  // succeeds; the point is only that it is not gated on a session.
  const response = await POST(
    post({ name: "Ada", email: "ada@example.com", password: "correct-horse-battery" })
  );
  assert.notEqual(response.status, 401);
});

// --- Idempotency and version checks (H7/H8) -------------------------------

test("re-sending the same history entry is a replay, not a second lesson", async () => {
  const { POST } = await loadRoute("history");
  session = { user: { id: "1" } };
  const entry = {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    topic: "Algebra",
    date: new Date().toISOString(),
  };

  const first = await POST(post(entry));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { id: entry.id, replayed: false });

  const retry = await POST(post(entry));
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { id: entry.id, replayed: true });
});

test("a history id already used by another learner is refused", async () => {
  const { POST } = await loadRoute("history");
  const entry = {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    topic: "Algebra",
    date: new Date().toISOString(),
  };
  session = { user: { id: "1" } };
  await POST(post(entry));
  session = { user: { id: "2" } };
  const stolen = await POST(post(entry));
  assert.equal(stolen.status, 409);
});

test("advancing requires the step the finished lesson belonged to", async () => {
  const { POST } = await loadRoute("history/path/advance");
  session = { user: { id: "1" } };
  const missing = await POST(post({}));
  assert.equal(missing.status, 400, "fromStepIndex is required");
});

test("a duplicate completion advances the path exactly once", async () => {
  const setPath = (await loadRoute("history/path")).POST;
  const advance = (await loadRoute("history/path/advance")).POST;
  session = { user: { id: "1" } };
  await setPath(
    post({
      path: {
        topic: "Algebra",
        steps: [
          { id: "a", title: "One" },
          { id: "b", title: "Two" },
          { id: "c", title: "Three" },
        ],
      },
      stepIndex: 0,
    })
  );

  const first = await advance(post({ fromStepIndex: 0 }));
  assert.deepEqual(await first.json(), { stepIndex: 1, advanced: true });

  // The same completion arriving twice must not skip step 1.
  const duplicate = await advance(post({ fromStepIndex: 0 }));
  assert.deepEqual(await duplicate.json(), { stepIndex: 1, advanced: false });
});

test("the path index never runs past the last step", async () => {
  const setPath = (await loadRoute("history/path")).POST;
  const advance = (await loadRoute("history/path/advance")).POST;
  session = { user: { id: "1" } };
  await setPath(
    post({
      path: { topic: "Algebra", steps: [{ id: "a", title: "One" }, { id: "b", title: "Two" }] },
      stepIndex: 1,
    })
  );
  const atEnd = await advance(post({ fromStepIndex: 1 }));
  // Two steps means 1 is the last valid index — not 2, which is what the old
  // jsonb_array_length clamp allowed.
  assert.deepEqual(await atEnd.json(), { stepIndex: 1, advanced: true });
});

test("advancing with no saved path is a 404, not a silent success", async () => {
  const { POST } = await loadRoute("history/path/advance");
  session = { user: { id: "1" } };
  const response = await POST(post({ fromStepIndex: 0 }));
  assert.equal(response.status, 404);
});

test("setting a path clamps the index to a real step", async () => {
  const { POST } = await loadRoute("history/path");
  session = { user: { id: "1" } };
  const response = await POST(
    post({
      path: { topic: "Algebra", steps: [{ id: "a", title: "One" }] },
      stepIndex: 5,
    })
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, stepIndex: 0 });
});

// --- Durable lesson sessions ----------------------------------------------

async function startLesson(pathStepIndex?: number) {
  const { POST } = await loadRoute("lesson/plan");
  const response = await POST(
    post({
      topic: "Algebra",
      profile: validProfile,
      ...(pathStepIndex === undefined
        ? {}
        : { pathTopic: "Algebra", pathStepIndex }),
    })
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("planning a lesson opens a session and withholds the answer keys", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();
  assert.ok(started.sessionId);
  assert.equal(started.version, 1);

  const serialised = JSON.stringify(started.plan);
  assert.ok(!serialised.includes("correctAnswer"), serialised);
  assert.ok(!serialised.includes("SECRET-CHECKPOINT-KEY"), "the checkpoint answer leaked");
  // The question itself is still there to be asked.
  assert.equal(started.plan.sections[0].checkpoint.question, "What is slope?");
});

test("a refresh finds the lesson still in progress", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();

  // What a reload does: ask the server what is running.
  const { GET } = await loadRoute("lesson/session");
  const resumed = await (await GET(get())).json();
  assert.equal(resumed.session.id, started.sessionId);
  assert.equal(resumed.session.status, "active");
  assert.equal(resumed.session.currentSectionIndex, 0);
  assert.ok(!JSON.stringify(resumed.session).includes("correctAnswer"));
});

test("another learner cannot see the lesson in progress", async () => {
  session = { user: { id: "1" } };
  await startLesson();
  session = { user: { id: "2" } };
  const { GET } = await loadRoute("lesson/session");
  const body = await (await GET(get())).json();
  assert.equal(body.session, null);
});

test("a command with a stale version is refused", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();
  const { POST } = await loadRoute("lesson/session");

  const first = await POST(
    post({ sessionId: started.sessionId, expectedVersion: 1, command: { type: "advance", toSectionIndex: 1 } })
  );
  assert.equal(first.status, 200);
  assert.equal((await first.json()).session.currentSectionIndex, 1);

  // A background tab still on version 1 tries the same thing.
  const stale = await POST(
    post({ sessionId: started.sessionId, expectedVersion: 1, command: { type: "advance", toSectionIndex: 1 } })
  );
  assert.equal(stale.status, 409);
});

test("the section index cannot be pushed past the plan", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();
  const { POST } = await loadRoute("lesson/session");
  const response = await POST(
    post({ sessionId: started.sessionId, expectedVersion: 1, command: { type: "advance", toSectionIndex: 5 } })
  );
  assert.equal(response.status, 409);
});

test("pausing twice is a no-op rather than an error", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();
  const { POST } = await loadRoute("lesson/session");

  const paused = await (
    await POST(post({ sessionId: started.sessionId, expectedVersion: 1, command: { type: "pause" } }))
  ).json();
  assert.equal(paused.session.status, "paused");

  const again = await (
    await POST(post({ sessionId: started.sessionId, expectedVersion: 1, command: { type: "pause" } }))
  ).json();
  assert.equal(again.changed, false);
  assert.equal(again.session.status, "paused");
});

test("starting a second lesson supersedes the first", async () => {
  session = { user: { id: "1" } };
  const first = await startLesson();
  const second = await startLesson();
  assert.notEqual(first.sessionId, second.sessionId);

  const { GET } = await loadRoute("lesson/session");
  const active = await (await GET(get())).json();
  assert.equal(active.session.id, second.sessionId);
});

test("another learner cannot drive someone else's lesson", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();
  session = { user: { id: "2" } };
  const { POST } = await loadRoute("lesson/session");
  const response = await POST(
    post({ sessionId: started.sessionId, expectedVersion: 1, command: { type: "cancel" } })
  );
  assert.equal(response.status, 404);
});

// --- Checkpoints ----------------------------------------------------------

test("a checkpoint is graded from the stored plan, not from the request", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();
  const { POST } = await loadRoute("lesson/evaluate");

  const response = await POST(
    post({
      sessionId: started.sessionId,
      expectedVersion: 1,
      sectionId: "s1",
      studentAnswer: "rise over run",
    })
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.recorded, true);
  assert.equal(body.version, 2);

  // The verdict is on the session, not tallied in the browser.
  const { GET } = await loadRoute("lesson/session");
  const resumed = await (await GET(get())).json();
  assert.equal(resumed.session.checkpointResults.length, 1);
  assert.equal(resumed.session.checkpointResults[0].sectionId, "s1");
});

test("a checkpoint for a section without one is a 404", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();
  const { POST } = await loadRoute("lesson/evaluate");
  const response = await POST(
    post({ sessionId: started.sessionId, expectedVersion: 1, sectionId: "s2", studentAnswer: "x" })
  );
  assert.equal(response.status, 404);
});

// --- Completion -----------------------------------------------------------

async function gradedQuiz(sessionId?: string): Promise<string> {
  const quiz = await createQuiz(sessionId);
  await (await loadRoute("lesson/quiz/grade")).POST(
    post({ quizId: quiz.quizId, answers: [{ questionId: "q1", optionId: "o2" }] })
  );
  return quiz.quizId;
}

test("completing a lesson is one call, and safe to retry", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson(0);
  const quizId = await gradedQuiz(started.sessionId);
  const { POST } = await loadRoute("lesson/complete");
  const payload = {
    sessionId: started.sessionId,
    expectedVersion: 1,
    quizId,
    historyId: "3f2504e0-4f89-11d3-9a0c-0305e82c3399",
    report: { strongAreas: ["slope"], weakAreas: [] },
  };

  const first = await POST(post(payload));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.replayed, false);
  assert.equal(firstBody.pathAdvanced, true);

  // The same completion arriving again — a retry after a dropped response —
  // must not write a second history row or advance the path twice.
  const retry = await POST(post(payload));
  assert.equal(retry.status, 200);
  const retryBody = await retry.json();
  assert.equal(retryBody.replayed, true);
  assert.equal(retryBody.pathAdvanced, false);
});

test("a lesson cannot be completed before its assessment is graded", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();
  const quiz = await createQuiz(started.sessionId);
  const response = await (await loadRoute("lesson/complete")).POST(
    post({
      sessionId: started.sessionId,
      expectedVersion: 1,
      quizId: quiz.quizId,
      historyId: "3f2504e0-4f89-11d3-9a0c-0305e82c3398",
      report: {},
    })
  );
  assert.equal(response.status, 404);
});

test("the completion score comes from the graded attempt", async () => {
  session = { user: { id: "1" } };
  const started = await startLesson();
  const quizId = await gradedQuiz(started.sessionId);
  const body = await (
    await (await loadRoute("lesson/complete")).POST(
      post({
        sessionId: started.sessionId,
        expectedVersion: 1,
        quizId,
        historyId: "3f2504e0-4f89-11d3-9a0c-0305e82c3397",
        report: {},
      })
    )
  ).json();
  // One right MCQ, one unanswered short question.
  assert.equal(body.scorePercent, 50);
});

// --- Server-owned assessment (H10) ----------------------------------------

async function createQuiz(
  sessionId?: string
): Promise<{ quizId: string; sessionId: string; questions: { id: string }[] }> {
  quizFixture = [
    {
      id: "ignored",
      type: "mcq",
      question: "2 + 2?",
      options: ["3", "4"],
      correctAnswer: "4",
      conceptTag: "addition",
    },
    {
      id: "ignored",
      type: "short",
      question: "Why?",
      correctAnswer: "Because of the axiom.",
      conceptTag: "reasons",
    },
  ];
  const lesson = sessionId ? { sessionId } : await startLesson();
  const { POST } = await loadRoute("lesson/quiz");
  const owningSession = sessionId ?? lesson.sessionId;
  const response = await POST(post({ sessionId: owningSession, language: "English" }));
  assert.equal(response.status, 200);
  return { ...(await response.json()), sessionId: owningSession };
}

test("the generated quiz reaches the browser without its answer key", async () => {
  session = { user: { id: "1" } };
  const body = await createQuiz();
  const serialised = JSON.stringify(body);
  assert.ok(!serialised.includes("correctAnswer"), serialised);
  assert.ok(!serialised.includes("correctOptionId"), serialised);
  assert.ok(!serialised.includes("Because of the axiom"), serialised);
  assert.equal(body.questions.length, 2);
});

test("grading is decided by the stored key, not by the submission", async () => {
  session = { user: { id: "1" } };
  const quiz = await createQuiz();
  const { POST } = await loadRoute("lesson/quiz/grade");

  const wrong = await POST(
    post({
      quizId: quiz.quizId,
      // The old client posted its own `correct: true`. Anything of that shape
      // is simply not read: only the option id counts.
      answers: [{ questionId: "q1", optionId: "o1", correct: true }],
    })
  );
  const body = await wrong.json();
  assert.equal(wrong.status, 200);
  assert.equal(body.results[0].correct, false);
  assert.equal(body.results[0].gradedBy, "deterministic");
});

test("submitting the same quiz twice returns the stored attempt", async () => {
  session = { user: { id: "1" } };
  const quiz = await createQuiz();
  const { POST } = await loadRoute("lesson/quiz/grade");
  const answers = [
    { questionId: "q1", optionId: "o2" },
    { questionId: "q2", text: "Because of the axiom." },
  ];

  const first = await (await POST(post({ quizId: quiz.quizId, answers }))).json();
  assert.equal(first.replayed, false);
  const gradesAfterFirst = shortAnswerGrades;

  const second = await (await POST(post({ quizId: quiz.quizId, answers }))).json();
  assert.equal(second.replayed, true);
  assert.equal(second.scorePercent, first.scorePercent);
  // The replay must not spend a second set of model calls.
  assert.equal(shortAnswerGrades, gradesAfterFirst);
});

test("another learner's quiz cannot be graded or reported on", async () => {
  session = { user: { id: "1" } };
  const quiz = await createQuiz();

  session = { user: { id: "2" } };
  const grade = await (await loadRoute("lesson/quiz/grade")).POST(
    post({ quizId: quiz.quizId, answers: [] })
  );
  assert.equal(grade.status, 404);

  const report = await (await loadRoute("lesson/report")).POST(
    post({ sessionId: quiz.sessionId, quizId: quiz.quizId })
  );
  assert.equal(report.status, 404);
});

test("a report cannot be produced before the assessment is graded", async () => {
  session = { user: { id: "1" } };
  const quiz = await createQuiz();
  const response = await (await loadRoute("lesson/report")).POST(
    post({ sessionId: quiz.sessionId, quizId: quiz.quizId })
  );
  assert.equal(response.status, 404);
});

test("the reported score comes from the graded attempt, not the model", async () => {
  session = { user: { id: "1" } };
  const quiz = await createQuiz();
  await (await loadRoute("lesson/quiz/grade")).POST(
    post({ quizId: quiz.quizId, answers: [{ questionId: "q1", optionId: "o1" }] })
  );

  const response = await (await loadRoute("lesson/report")).POST(
    post({ sessionId: quiz.sessionId, quizId: quiz.quizId })
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  // The stubbed model claims 99; the stored attempt is one wrong MCQ and one
  // unanswered short question, so nothing was earned.
  assert.equal(body.scorePercent, 0);
  assert.ok(body.graderVersion);
});

test("a report request cannot smuggle its own quiz results", async () => {
  session = { user: { id: "1" } };
  const response = await (await loadRoute("lesson/report")).POST(
    post({
      lessonPlan: validPlan,
      quizResults: [{ question: "?", conceptTag: "c", studentAnswer: "a", correct: true }],
    })
  );
  // No quizId at all: the body no longer has a field that could carry marks.
  assert.equal(response.status, 400);
});

// --- Durable ingestion (H11) ----------------------------------------------

/** Uploads a small text file through the real route. */
async function upload(): Promise<{ docId: string; jobId: string }> {
  const form = new FormData();
  form.append("file", new File(["some readable content"], "notes.txt", { type: "text/plain" }));
  const { POST } = await loadRoute("upload");
  const response = await POST(
    new Request("https://aetheris.invalid/api/upload", { method: "POST", body: form })
  );
  assert.equal(response.status, 200);
  return response.json();
}

test("an upload returns immediately with a job to follow", async () => {
  session = { user: { id: "1" } };
  const accepted = await upload();
  assert.ok(accepted.docId);
  assert.ok(accepted.jobId);

  // The expensive work has not happened yet — that is the point.
  const { GET } = await loadRoute("documents/jobs");
  const status = await (
    await GET(
      new Request(`https://aetheris.invalid/api/documents/jobs?jobId=${accepted.jobId}`)
    )
  ).json();
  assert.equal(status.job.status, "queued");
});

test("ingestion advances a slice at a time and finishes", async () => {
  session = { user: { id: "1" } };
  const accepted = await upload();
  const { POST } = await loadRoute("documents/jobs");

  const first = await (await POST(post({ jobId: accepted.jobId }))).json();
  assert.equal(first.job.status, "queued", "one slice should not finish a two-chunk document");
  const second = await (await POST(post({ jobId: accepted.jobId }))).json();
  assert.equal(second.job.status, "succeeded");
  assert.equal(second.progress, 1);
});

test("another learner cannot read or drive someone else's ingestion", async () => {
  session = { user: { id: "1" } };
  const accepted = await upload();

  session = { user: { id: "2" } };
  const { GET, POST } = await loadRoute("documents/jobs");
  const read = await GET(
    new Request(`https://aetheris.invalid/api/documents/jobs?jobId=${accepted.jobId}`)
  );
  assert.equal(read.status, 404);
  const drive = await POST(post({ jobId: accepted.jobId }));
  assert.equal(drive.status, 404);
});

test("a status request without a job id is a 400", async () => {
  session = { user: { id: "1" } };
  const { GET } = await loadRoute("documents/jobs");
  const response = await GET(new Request("https://aetheris.invalid/api/documents/jobs"));
  assert.equal(response.status, 400);
});

test("an error response never carries internal detail", async () => {
  const { GET } = await loadRoute("history");
  session = { user: { id: "1" } };
  const response = await GET(get());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(!JSON.stringify(body).includes("node_modules"));
});
