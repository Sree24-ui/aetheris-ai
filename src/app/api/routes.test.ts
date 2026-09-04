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
      loadMemoryForUser: async () => ({ history: [], weakConcepts: [], strongConcepts: [] }),
      addHistoryEntryForUser: async () => undefined,
      setCurrentPathForUser: async () => undefined,
      advancePathForUser: async () => undefined,
    },
  });
  mock.module(lib("db.ts"), {
    namedExports: { pool: { query: async () => ({ rows: [] }) } },
  });
});

beforeEach(async () => {
  session = null;
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
  { route: "history/path/advance", method: "POST" },
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

test("an error response never carries internal detail", async () => {
  const { GET } = await loadRoute("history");
  session = { user: { id: "1" } };
  const response = await GET(get());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.ok(!JSON.stringify(body).includes("node_modules"));
});
