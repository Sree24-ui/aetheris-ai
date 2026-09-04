import { test } from "node:test";
import assert from "node:assert/strict";
import {
  historyEntryRequestSchema,
  learnerProfileSchema,
  lessonChatRequestSchema,
  lessonPlanRequestSchema,
  profilePatchSchema,
  registerRequestSchema,
  setPathRequestSchema,
} from "./requests";
import { lessonPlanSchema, quizSchema } from "./model";

/**
 * Regression tests for H2. Every request body was previously accepted on the
 * strength of a TypeScript cast, so anything that was syntactically JSON got
 * through to prompt construction, the model, or the database.
 */

const validProfile = {
  level: "beginner" as const,
  language: "English",
  availableMinutes: 20,
};

test("a well-formed lesson request is accepted", () => {
  const parsed = lessonPlanRequestSchema.parse({ topic: "Algebra", profile: validProfile });
  assert.equal(parsed.topic, "Algebra");
  assert.equal(parsed.docId, undefined);
});

test("lesson duration is bounded, integral and server-checked", () => {
  for (const availableMinutes of [0, -5, 1.5, 100000, "20", null]) {
    assert.equal(
      learnerProfileSchema.safeParse({ ...validProfile, availableMinutes }).success,
      false,
      String(availableMinutes)
    );
  }
  assert.equal(learnerProfileSchema.safeParse({ ...validProfile, availableMinutes: 240 }).success, true);
});

test("an unknown level is refused rather than passed to the prompt", () => {
  assert.equal(learnerProfileSchema.safeParse({ ...validProfile, level: "expert" }).success, false);
});

test("a docId must be a UUID, so it cannot be a crafted lookup value", () => {
  for (const docId of ["' OR 1=1 --", "../../etc/passwd", "12345", ""]) {
    assert.equal(
      lessonPlanRequestSchema.safeParse({ topic: "t", profile: validProfile, docId }).success,
      false,
      docId
    );
  }
  assert.equal(
    lessonPlanRequestSchema.safeParse({
      topic: "t",
      profile: validProfile,
      docId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    }).success,
    true
  );
});

test("an empty or oversized topic is refused", () => {
  assert.equal(lessonPlanRequestSchema.safeParse({ topic: "", profile: validProfile }).success, false);
  assert.equal(
    lessonPlanRequestSchema.safeParse({ topic: "x".repeat(5000), profile: validProfile }).success,
    false
  );
});

test("chat history is bounded so a request cannot inflate the prompt", () => {
  const oversized = Array.from({ length: 500 }, () => ({ role: "user" as const, text: "hi" }));
  assert.equal(
    lessonChatRequestSchema.safeParse({ question: "why?", history: oversized }).success,
    false
  );
  assert.equal(lessonChatRequestSchema.safeParse({ question: "why?" }).success, true);
});

test("a history entry needs a real UUID and a parseable date", () => {
  const base = {
    id: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    topic: "Algebra",
    date: new Date().toISOString(),
  };
  assert.equal(historyEntryRequestSchema.safeParse(base).success, true);
  assert.equal(historyEntryRequestSchema.safeParse({ ...base, id: "not-a-uuid" }).success, false);
  assert.equal(historyEntryRequestSchema.safeParse({ ...base, date: "tomorrow" }).success, false);
  assert.equal(
    historyEntryRequestSchema.safeParse({ ...base, scorePercent: 1000 }).success,
    false
  );
});

test("a learning path step index cannot be pushed out of range", () => {
  const path = {
    topic: "Algebra",
    steps: [
      { id: "a", title: "One", description: "" },
      { id: "b", title: "Two", description: "" },
    ],
  };
  assert.equal(setPathRequestSchema.safeParse({ path, stepIndex: -1 }).success, false);
  assert.equal(setPathRequestSchema.safeParse({ path, stepIndex: 999 }).success, false);
  assert.equal(setPathRequestSchema.safeParse({ path, stepIndex: 1.5 }).success, false);
  assert.equal(setPathRequestSchema.safeParse({ path, stepIndex: 1 }).success, true);
});

test("a profile name is bounded to what the column can store", () => {
  assert.equal(profilePatchSchema.safeParse({ name: "  Ada  " }).data?.name, "Ada");
  assert.equal(profilePatchSchema.safeParse({ name: "" }).success, false);
  assert.equal(profilePatchSchema.safeParse({ name: "   " }).success, false);
  assert.equal(profilePatchSchema.safeParse({ name: "a".repeat(300) }).success, false);
});

test("registration normalises the email and enforces password bounds", () => {
  const schema = registerRequestSchema(8);
  const ok = schema.parse({ name: "Ada", email: "  ADA@Example.COM ", password: "correct-horse" });
  assert.equal(ok.email, "ada@example.com");
  assert.equal(schema.safeParse({ name: "Ada", email: "nope", password: "correct-horse" }).success, false);
  assert.equal(schema.safeParse({ name: "Ada", email: "a@b.co", password: "short" }).success, false);
  assert.equal(
    schema.safeParse({ name: "Ada", email: "a@b.co", password: "x".repeat(5000) }).success,
    false
  );
});

// --- Model output, replayed as a client-supplied body ---------------------

const validSection = {
  id: "s1",
  title: "Slope",
  narration: "The slope of a line is its rise over run.",
  bulletPoints: ["rise over run"],
  visual: { type: "none" },
  estimatedSeconds: 60,
  conceptTags: ["slope"],
};

test("a lesson plan sent back by the client is bounded", () => {
  const plan = {
    topic: "Algebra",
    subject: "mathematics",
    language: "English",
    totalEstimatedMinutes: 20,
    sections: [validSection],
    finalQuizTopics: ["slope"],
    sourceGrounded: false,
  };
  assert.equal(lessonPlanSchema.safeParse(plan).success, true);
  assert.equal(lessonPlanSchema.safeParse({ ...plan, sections: [] }).success, false);
  assert.equal(
    lessonPlanSchema.safeParse({
      ...plan,
      sections: Array.from({ length: 200 }, () => validSection),
    }).success,
    false
  );
});

test("a graph spec must carry a string expression and finite bounds", () => {
  const withGraph = (graph: unknown) => ({
    topic: "Algebra",
    subject: "mathematics",
    language: "English",
    totalEstimatedMinutes: 20,
    sections: [{ ...validSection, visual: { type: "graph", graph } }],
    sourceGrounded: false,
  });
  assert.equal(
    lessonPlanSchema.safeParse(withGraph({ expression: "sin(x)", xMin: -5, xMax: 5 })).success,
    true
  );
  for (const graph of [
    { expression: { evil: true }, xMin: -5, xMax: 5 },
    { expression: "x", xMin: "a", xMax: 5 },
    { expression: "x".repeat(5000), xMin: -5, xMax: 5 },
  ]) {
    assert.equal(lessonPlanSchema.safeParse(withGraph(graph)).success, false, JSON.stringify(graph));
  }
});

test("a quiz cannot arrive empty or unbounded", () => {
  const question = { id: "q1", type: "mcq", question: "2+2?", options: ["3", "4"], conceptTag: "sums" };
  assert.equal(quizSchema.safeParse([question]).success, true);
  assert.equal(quizSchema.safeParse([]).success, false);
  assert.equal(
    quizSchema.safeParse(Array.from({ length: 100 }, () => question)).success,
    false
  );
  assert.equal(quizSchema.safeParse([{ ...question, type: "essay" }]).success, false);
});
