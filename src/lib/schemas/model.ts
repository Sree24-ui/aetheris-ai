import { z } from "zod";

/**
 * Runtime schemas for everything the model produces (H2).
 *
 * `callModelJSON` used to `JSON.parse` a response and cast it to the expected
 * TypeScript type. `JSON.parse` proves the bytes are JSON and nothing else —
 * not that `sections` is an array, not that `scorePercent` is a number, not
 * that `graph.expression` is a string rather than an object that crashes the
 * renderer. Compile-time types do not survive to runtime, so a plausible but
 * wrong model response reached components and the database unchecked.
 *
 * Every schema below is deliberately bounded as well as typed: array lengths
 * and string lengths cap how much work one response can create downstream
 * (prompt size on the next call, DOM nodes, database rows, narration time).
 *
 * The prompts ask for `null` on absent optional fields, so `nullish` plus a
 * transform to `undefined` is used wherever the domain type has `?:`.
 */

/** Collapses the model's `null` into the `undefined` the domain types use. */
const optionalString = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => (v == null || v.trim() === "" ? undefined : v));

const shortText = z.string().min(1).max(400);
const mediumText = z.string().min(1).max(4000);
const longText = z.string().min(1).max(8000);
const identifier = z.string().min(1).max(120);

export const MAX_SECTIONS = 20;
export const MAX_QUIZ_QUESTIONS = 12;
export const MAX_OPTIONS = 8;
export const MAX_PATH_STEPS = 20;

export const graphSpecSchema = z.object({
  // Validity as an *expression* is decided by the parser in
  // security/mathExpression.ts at render time; this only guarantees the field
  // is a bounded string rather than an object or an array.
  expression: z.string().min(1).max(256),
  xMin: z.number().finite(),
  xMax: z.number().finite(),
  label: optionalString(200),
});

export const timelineEventSchema = z.object({
  date: z.string().min(1).max(100),
  event: z.string().min(1).max(600),
});

export const visualSpecSchema = z.object({
  type: z.enum(["none", "markdown", "equation", "graph", "mermaid", "code", "timeline"]),
  content: optionalString(8000),
  codeLanguage: optionalString(40),
  graph: graphSpecSchema.nullish().transform((v) => v ?? undefined),
  timeline: z
    .array(timelineEventSchema)
    .max(40)
    .nullish()
    .transform((v) => v ?? undefined),
});

export const checkpointQuestionSchema = z.object({
  id: identifier,
  type: z.enum(["mcq", "short", "application"]),
  question: mediumText,
  options: z
    .array(z.string().min(1).max(600))
    .max(MAX_OPTIONS)
    .nullish()
    .transform((v) => v ?? undefined),
  correctAnswer: optionalString(2000),
  conceptTag: z.string().min(1).max(120),
});

export const lessonSectionSchema = z.object({
  id: identifier,
  title: shortText,
  narration: longText,
  bulletPoints: z.array(z.string().min(1).max(600)).max(12).default([]),
  visual: visualSpecSchema.nullish().transform((v) => v ?? { type: "none" as const }),
  example: optionalString(8000),
  checkpoint: checkpointQuestionSchema.nullish().transform((v) => v ?? undefined),
  // A section that claims to take a week would stall the lesson clock.
  estimatedSeconds: z.number().int().min(1).max(3600).catch(120),
  conceptTags: z.array(z.string().min(1).max(120)).max(20).default([]),
});

export const lessonPlanSchema = z.object({
  topic: shortText,
  subject: z.string().min(1).max(120),
  levelSummary: z.string().max(2000).default(""),
  totalEstimatedMinutes: z.number().int().min(1).max(600).catch(20),
  language: z.string().min(1).max(80),
  sections: z.array(lessonSectionSchema).min(1).max(MAX_SECTIONS),
  finalQuizTopics: z.array(z.string().min(1).max(200)).max(30).default([]),
  sourceGrounded: z.boolean().default(false),
});

export const evalResultSchema = z.object({
  correct: z.boolean(),
  partialCredit: z.number().min(0).max(1).catch(0),
  misconception: optionalString(2000),
  feedback: z.string().max(4000).default(""),
  remediation: z
    .object({
      reExplanation: z.string().max(8000).default(""),
      analogy: optionalString(4000),
      extraExample: optionalString(4000),
    })
    .nullish()
    .transform((v) => v ?? undefined),
});

export const quizQuestionSchema = z.object({
  id: identifier,
  type: z.enum(["mcq", "short"]),
  question: mediumText,
  options: z
    .array(z.string().min(1).max(600))
    .max(MAX_OPTIONS)
    .nullish()
    .transform((v) => v ?? undefined),
  correctAnswer: optionalString(2000),
  conceptTag: z.string().min(1).max(120),
});

export const quizSchema = z.array(quizQuestionSchema).min(1).max(MAX_QUIZ_QUESTIONS);

export const learningReportSchema = z.object({
  topic: shortText,
  scorePercent: z.number().min(0).max(100),
  strongAreas: z.array(z.string().min(1).max(200)).max(40).default([]),
  weakAreas: z.array(z.string().min(1).max(200)).max(40).default([]),
  incorrectConcepts: z.array(z.string().min(1).max(200)).max(40).default([]),
  recommendation: z.string().max(4000).default(""),
  suggestedNextTopic: z.string().max(400).default(""),
});

export const learningPathStepSchema = z.object({
  id: identifier,
  title: shortText,
  description: z.string().max(2000).default(""),
});

export const learningPathSchema = z.object({
  topic: shortText,
  steps: z.array(learningPathStepSchema).min(1).max(MAX_PATH_STEPS),
});

export const conceptsSchema = z.object({
  concepts: z.array(z.string().min(1).max(120)).max(20).default([]),
});

/**
 * A rubric grade for one short answer. Deliberately narrow: the grader is
 * asked for a verdict and a sentence, not for anything that could redirect
 * the lesson or leak the reference answer verbatim.
 */
export const rubricGradeSchema = z.object({
  correct: z.boolean(),
  partialCredit: z.number().min(0).max(1).catch(0),
  feedback: z.string().max(1200).default(""),
});

export const chatAnswerSchema = z.object({
  answer: z.string().min(1).max(8000),
  suggestedFollowUps: z.array(z.string().min(1).max(400)).max(5).default([]),
});

export const parsedInstructionSchema = z.object({
  topic: optionalString(400),
  level: z.enum(["beginner", "intermediate", "advanced"]).nullish().transform((v) => v ?? undefined),
  language: optionalString(80),
  availableMinutes: z
    .number()
    .int()
    .min(1)
    .max(600)
    .nullish()
    .transform((v) => v ?? undefined),
  objective: optionalString(1000),
  style: optionalString(400),
});
