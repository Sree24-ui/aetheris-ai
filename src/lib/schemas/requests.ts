import { z } from "zod";
import {
  checkpointQuestionSchema,
  lessonPlanSchema,
  lessonSectionSchema,
  quizQuestionSchema,
} from "./model";

/**
 * Runtime schemas for every request body the API accepts (H2).
 *
 * Handlers previously did `const body = await req.json()` and passed the
 * result straight into prompt construction or the database, with only a
 * TypeScript cast in between. That cast is erased at runtime, so a body of
 * `{"topic": {"toString": ...}}` or a 50 MB `history` array was accepted and
 * turned into model spend or a database write.
 *
 * Bounds here are the first line of the abuse controls in H5: nothing may
 * arrive that is larger than the product could plausibly need.
 */

/**
 * The teaching language. Free text is accepted (the instruction parser can
 * infer a language the picker does not list) but bounded, and it is only ever
 * interpolated into a prompt, never into markup or a query.
 */
const language = z.string().min(1).max(80).default("English");

const topic = z.string().trim().min(1).max(300);

export const learnerProfileSchema = z.object({
  level: z.enum(["beginner", "intermediate", "advanced"]),
  language,
  // Server-side integer and range validation, so a hand-crafted request
  // cannot ask for a 10,000-minute lesson and the token spend that implies.
  availableMinutes: z.number().int().min(1).max(240),
  objective: z.string().max(1000).optional(),
  style: z.string().max(400).optional(),
  existingKnowledge: z.string().max(2000).optional(),
});

export const transcriptMessageSchema = z.object({
  role: z.enum(["ai", "user"]),
  text: z.string().max(20_000),
});

// --- /api/instruction -----------------------------------------------------

export const instructionRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
});

// --- /api/learning-path ---------------------------------------------------

export const learningPathRequestSchema = z.object({
  topic,
  profile: learnerProfileSchema,
});

// --- /api/lesson/plan -----------------------------------------------------

export const lessonPlanRequestSchema = z.object({
  topic,
  profile: learnerProfileSchema,
  docId: z.uuid().optional(),
});

// --- /api/lesson/chat -----------------------------------------------------

export const lessonChatRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  lessonTopic: z.string().max(300).default(""),
  sectionTitle: z.string().max(400).default(""),
  sectionContext: z.string().max(20_000).default(""),
  language,
  history: z.array(transcriptMessageSchema).max(50).default([]),
});

// --- /api/lesson/evaluate -------------------------------------------------

export const lessonEvaluateRequestSchema = z.object({
  question: checkpointQuestionSchema,
  studentAnswer: z.string().max(8000).default(""),
  sectionContext: z.string().max(20_000).default(""),
  language,
});

// --- /api/lesson/quiz -----------------------------------------------------

export const lessonQuizRequestSchema = z.object({
  lessonPlan: lessonPlanSchema,
  language,
});

// --- /api/lesson/report ---------------------------------------------------

export const lessonReportRequestSchema = z.object({
  lessonPlan: lessonPlanSchema,
  quizResults: z
    .array(
      z.object({
        question: quizQuestionSchema,
        studentAnswer: z.string().max(8000).default(""),
        correct: z.boolean(),
      })
    )
    .max(50)
    .default([]),
  checkpointResults: z
    .array(z.object({ conceptTag: z.string().min(1).max(120), correct: z.boolean() }))
    .max(50)
    .default([]),
  language,
});

// --- /api/lesson/translate-section ----------------------------------------

export const translateSectionRequestSchema = z.object({
  section: lessonSectionSchema,
  targetLanguage: z.string().min(1).max(80),
});

// --- /api/history ---------------------------------------------------------

export const historyEntryRequestSchema = z.object({
  id: z.uuid(),
  topic,
  // Rejected rather than coerced: an unparseable date would land in a
  // TIMESTAMPTZ column as whatever Postgres decided it meant.
  date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO 8601 timestamp"),
  language: z.string().max(80).default(""),
  subject: z.string().max(120).optional(),
  scorePercent: z.number().min(0).max(100).optional(),
  strongAreas: z.array(z.string().min(1).max(200)).max(40).default([]),
  weakAreas: z.array(z.string().min(1).max(200)).max(40).default([]),
  recommendation: z.string().max(4000).optional(),
  transcript: z.array(transcriptMessageSchema).max(400).default([]),
  quiz: z
    .array(
      z.object({
        question: z.string().max(4000),
        studentAnswer: z.string().max(8000),
        correct: z.boolean(),
      })
    )
    .max(50)
    .default([]),
});

// --- /api/history/path ----------------------------------------------------

export const setPathRequestSchema = z.object({
  path: z.object({
    topic,
    steps: z
      .array(
        z.object({
          id: z.string().min(1).max(120),
          title: z.string().min(1).max(400),
          description: z.string().max(2000).default(""),
        })
      )
      .min(1)
      .max(20),
  }),
  stepIndex: z.number().int().min(0).max(19).default(0),
});

// --- /api/profile ---------------------------------------------------------

export const profilePatchSchema = z.object({
  // Matches the users.name VARCHAR(255) column, so a name that validates here
  // can always be stored.
  name: z.string().trim().min(1).max(255),
});

// --- /api/auth/register ---------------------------------------------------

export function registerRequestSchema(minPasswordLength: number) {
  return z.object({
    name: z.string().trim().min(1).max(255),
    // Normalised before the format check, so " ADA@Example.com " and
    // "ada@example.com" cannot become two accounts.
    email: z
      .string()
      .max(254)
      .transform((v) => v.trim().toLowerCase())
      .pipe(z.email()),
    // Upper bound matters: bcrypt cost is paid by the server, and bcrypt
    // itself only reads the first 72 bytes anyway.
    password: z.string().min(minPasswordLength).max(200),
  });
}
