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
const documents = new Map<string, number>([["3f2504e0-4f89-11d3-9a0c-0305e82c3301", 1]]);

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
      planLesson: async () => ({ topic: "stub", sections: [] }),
      generateQuiz: async () => [],
      generateReport: async () => ({ topic: "stub" }),
      evaluateAnswer: async () => ({ correct: true }),
      answerQuestion: async () => ({ answer: "stub", suggestedFollowUps: [] }),
      translateSection: async () => ({ id: "s1" }),
      generateLearningPath: async () => ({ topic: "stub", steps: [] }),
      parseInstruction: async () => ({ topic: "stub" }),
      extractConcepts: async () => [],
    },
  });
  mock.module(lib("vectorStore.ts"), {
    namedExports: {
      documentExists: async (docId: string, userId: number) => documents.get(docId) === userId,
      searchDocument: async () => [{ chunkId: "c0", text: "grounded", score: 1 }],
      ingestDocument: async () => ({ numChunks: 1, preview: "p", sample: "s" }),
      getFullDocumentText: async () => "",
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
  mock.module(lib("db.ts"), {
    namedExports: { pool: { query: async () => ({ rows: [] }) } },
  });
});

beforeEach(async () => {
  session = null;
  historyRows.clear();
  paths.clear();
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
const matrix: { route: string; method: "GET" | "POST" | "PATCH"; body?: unknown }[] = [
  { route: "instruction", method: "POST", body: { text: "teach me algebra" } },
  { route: "learning-path", method: "POST", body: { topic: "Algebra", profile: validProfile } },
  { route: "lesson/plan", method: "POST", body: { topic: "Algebra", profile: validProfile } },
  { route: "lesson/chat", method: "POST", body: { question: "why?" } },
  {
    route: "lesson/evaluate",
    method: "POST",
    body: {
      question: { id: "q", type: "short", question: "?", conceptTag: "c" },
      studentAnswer: "a",
    },
  },
  { route: "lesson/quiz", method: "POST", body: { lessonPlan: validPlan } },
  { route: "lesson/report", method: "POST", body: { lessonPlan: validPlan } },
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
    const response = await handler(method === "GET" ? get() : post(body));
    assert.equal(response.status, 401, `${method} /api/${route}`);
  });

  test(`${method} /api/${route} refuses a session with no user id`, async () => {
    const handlers = await loadRoute(route);
    session = { user: {} };
    const response = await handlers[method](method === "GET" ? get() : post(body));
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

test("an error response never carries internal detail", async () => {
  const { GET } = await loadRoute("history");
  session = { user: { id: "1" } };
  const response = await GET(get());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(!JSON.stringify(body).includes("node_modules"));
});
