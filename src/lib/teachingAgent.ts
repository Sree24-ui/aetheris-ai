import { callModelJSON } from "./llm";
import type {
  LearnerProfile,
  LessonPlan,
  EvalResult,
  QuizQuestion,
  LearningReport,
  LearningPath,
  CheckpointQuestion,
  LessonSection,
} from "./types";

const VISUAL_GUIDE = `
Choose the visual "type" for each section based on the subject matter, and fill "content" appropriately:
- "equation": content = a LaTeX expression (no $ delimiters), for math derivations/formulas.
- "graph": omit content; instead fill "graph": { "expression": "a JS-evaluable function of x, e.g. 'Math.sin(x)' or 'x*x'", "xMin": number, "xMax": number, "label": string }.
- "mermaid": content = valid Mermaid diagram syntax (flowchart/graph/sequenceDiagram/timeline/mindmap) for processes, architecture, execution flow, biological processes, historical timelines with few events, or structures.
- "code": content = source code; also set "codeLanguage" (e.g. "python", "javascript", "cpp").
- "timeline": omit content; instead fill "timeline": [{ "date": "...", "event": "..." }, ...] for history/chronological topics (prefer this over mermaid for 4+ dated events).
- "markdown": content = formatted markdown text (lists, bold) when no diagram/equation/code is the natural fit.
- "none": no visual needed for this section.
Pick the visual type that best matches the subject: math->equation/graph, physics->mermaid diagram or equation, biology->mermaid (labeled process/structure), history->timeline, programming->code plus mermaid for architecture/execution flow.
`;

const JSON_ONLY = "Respond with ONLY valid JSON. No markdown fences, no commentary before or after.";

function profileBlock(profile: LearnerProfile): string {
  return `Learner profile:
- Level: ${profile.level}
- Preferred teaching language: ${profile.language}
- Available time: ${profile.availableMinutes} minutes
- Objective: ${profile.objective || "general understanding"}
- Preferred style: ${profile.style || "clear and structured"}
- Existing knowledge: ${profile.existingKnowledge || "not specified"}`;
}

export async function extractConcepts(sampleText: string): Promise<string[]> {
  const system = `You scan a short excerpt from an uploaded educational document and list the key concepts/topics it covers, as they would appear as short tags. ${JSON_ONLY}`;
  const user = `Excerpt:\n${sampleText}\n\nReturn JSON: { "concepts": string[] } — 4 to 6 short (1-4 word) concept tags, in the document's own language.`;
  // Deliberately not swallowing failures here any more: returning [] made a
  // quota-blocked extraction indistinguishable from a document that genuinely
  // has no concepts, so the panel just looked broken. The caller decides how
  // to degrade.
  const result = await callModelJSON<{ concepts: string[] }>(system, user, 300);
  return Array.isArray(result.concepts) ? result.concepts.slice(0, 6) : [];
}

export async function parseInstruction(freeText: string): Promise<{
  topic?: string;
  level?: LearnerProfile["level"];
  language?: string;
  availableMinutes?: number;
  objective?: string;
  style?: string;
}> {
  const system = `You extract structured teaching preferences from a student's free-text instruction (which may mix languages, e.g. Hindi/English/Hinglish). ${JSON_ONLY}`;
  const user = `Instruction: "${freeText}"

Return JSON with any fields you can confidently infer (omit fields you cannot infer):
{
  "topic": string | omit,
  "level": "beginner"|"intermediate"|"advanced" | omit,
  "language": string (name of the language the student wants to be TAUGHT in) | omit,
  "availableMinutes": number | omit,
  "objective": string | omit,
  "style": string | omit
}`;
  return callModelJSON(system, user, 512);
}

/**
 * Free-form Q&A during a lesson.
 *
 * Kept separate from `evaluateAnswer`: that one grades a checkpoint the teacher
 * asked, this one answers a question the *student* asked, which must not affect
 * scoring and must not drag the lesson off course.
 */
export async function answerQuestion(params: {
  question: string;
  lessonTopic: string;
  sectionTitle: string;
  sectionContext: string;
  language: string;
  history: { role: "ai" | "user"; text: string }[];
}): Promise<{ answer: string; suggestedFollowUps: string[] }> {
  const { question, lessonTopic, sectionTitle, sectionContext, language, history } = params;

  const system = `You are the student's AI teacher, answering a question they asked mid-lesson.

Rules:
- Answer the question directly first, then add at most one clarifying detail.
- Stay anchored to the lesson: connect the answer back to what is being taught.
- Be concrete. Use a specific number, worked step, or named example rather than a general description.
- Keep it short enough to be spoken aloud: 2-4 sentences.
- If the question is off-topic, answer briefly and steer back to the lesson in one clause.
- If you genuinely do not know, say so instead of inventing specifics.
Respond in ${language}. ${JSON_ONLY}`;

  // Only the tail of the conversation is sent: enough for pronouns and
  // follow-ups to resolve, without growing the prompt (and the bill) as the
  // lesson goes on.
  const recent = history.slice(-6).map((m) => `${m.role === "ai" ? "Teacher" : "Student"}: ${m.text}`);

  const user = `Lesson topic: ${lessonTopic}
Current section: ${sectionTitle}
What was just taught: ${sectionContext}

${recent.length ? `Recent conversation:\n${recent.join("\n")}\n` : ""}
Student's question: "${question}"

Return JSON:
{
  "answer": string,                 // spoken-style answer in ${language}
  "suggestedFollowUps": string[]    // 0-2 short follow-up questions the student might ask next, in ${language}
}`;

  return callModelJSON<{ answer: string; suggestedFollowUps: string[] }>(system, user, 1024);
}

export async function planLesson(params: {
  topic: string;
  profile: LearnerProfile;
  groundedContext?: string;
  isDocumentGrounded: boolean;
}): Promise<LessonPlan> {
  const { topic, profile, groundedContext, isDocumentGrounded } = params;

  const system = `You are an expert AI teacher designing a personalized lesson, following the pedagogy:
Understand -> Plan -> Explain -> Demonstrate -> Question -> Evaluate -> Adapt -> Continue.

Rules:
- Break the lesson into sections. Each section introduces or builds on ONE concept at a time.
- Explanations must progress from simple to complex, matching the learner's level.
- Every 1-2 sections should include a "checkpoint" question that tests the concept just taught (not every single section needs one, but most should).

Be specific, not generic. This is the difference between a good lesson and a useless one:
- Every section's "example" must be a CONCRETE worked case — real numbers, a named system, an actual code snippet or a specific scenario. Never "for example, consider a simple case".
- Narration must teach the actual content, not describe what will be taught. Write "Force equals mass times acceleration, so a 2 kg mass at 3 m/s² needs 6 N", never "in this section we will explore the relationship between force and mass".
- Ban filler openers ("Let's dive in", "In today's lesson", "As we all know") and empty summaries ("In conclusion, this is an important topic").
- Prefer the precise term over the vague one, and define it the first time you use it.
- Checkpoint questions must require applying the concept, not recalling a word from the narration.
- Adjust total depth/number of sections to fit the available time: 5 minutes -> 2-3 concise sections, 20 minutes -> 4-6 sections, 60 minutes -> 7-10 sections with deeper explanation, examples, and more checkpoints.
- All narration and text MUST be written in the learner's preferred teaching language.
- ${isDocumentGrounded ? "Base the lesson strictly on the provided source material context. Do not invent facts not supported by it. If the context is insufficient for a sub-topic, note that briefly rather than fabricating specifics." : "No source material was provided; teach the topic from general subject knowledge, appropriate to the learner's level."}
${VISUAL_GUIDE}
${JSON_ONLY}`;

  const user = `Topic to teach: ${topic}

${profileBlock(profile)}

${groundedContext ? `Source material context (grounded, use this as the primary source of truth):\n${groundedContext}` : ""}

Return JSON exactly matching this TypeScript type:
{
  "topic": string,
  "subject": string,               // e.g. "mathematics","physics","biology","history","programming","general"
  "levelSummary": string,          // one sentence describing how depth was tailored to the learner
  "totalEstimatedMinutes": number,
  "language": string,
  "sections": [
    {
      "id": string,
      "title": string,
      "narration": string,         // what the teacher says, 2-5 sentences, in the target language
      "bulletPoints": string[],    // 2-4 short on-screen bullet points, in the target language
      "visual": { "type": "none"|"markdown"|"equation"|"graph"|"mermaid"|"code"|"timeline", "content": string|null, "codeLanguage": string|null, "graph": object|null, "timeline": array|null },
      "example": string|null,
      "checkpoint": { "id": string, "type": "mcq"|"short"|"application", "question": string, "options": string[]|null, "correctAnswer": string|null, "conceptTag": string } | null,
      "estimatedSeconds": number,
      "conceptTags": string[]
    }
  ],
  "finalQuizTopics": string[],
  "sourceGrounded": ${isDocumentGrounded}
}`;

  return callModelJSON<LessonPlan>(system, user, 8192);
}

export async function evaluateAnswer(params: {
  question: CheckpointQuestion;
  studentAnswer: string;
  sectionContext: string;
  language: string;
}): Promise<EvalResult> {
  const { question, studentAnswer, sectionContext, language } = params;
  const system = `You are an AI teacher evaluating a student's answer during a live lesson. You must:
1. Judge correctness (be lenient on phrasing, strict on concept).
2. If wrong or partially wrong, identify the likely MISCONCEPTION (the specific wrong mental model), not just "incorrect".
3. Produce a short constructive re-explanation targeting that misconception, ideally with a different analogy than already used.
Respond in ${language}. ${JSON_ONLY}`;

  const user = `Section context (what was just taught): ${sectionContext}

Question asked: ${question.question}
${question.options ? `Options: ${question.options.join(" | ")}` : ""}
${question.correctAnswer ? `Reference correct answer: ${question.correctAnswer}` : ""}

Student's answer: "${studentAnswer}"

Return JSON:
{
  "correct": boolean,
  "partialCredit": number,       // 0 to 1
  "misconception": string|null,
  "feedback": string,            // short, encouraging, spoken-style feedback
  "remediation": { "reExplanation": string, "analogy": string|null, "extraExample": string|null } | null
}`;

  return callModelJSON<EvalResult>(system, user, 1536);
}

export async function generateQuiz(params: {
  lessonPlan: LessonPlan;
  language: string;
}): Promise<QuizQuestion[]> {
  const { lessonPlan, language } = params;
  const system = `You create an end-of-lesson assessment covering the concepts actually taught. Mix MCQ and short-answer questions. Respond in ${language}. ${JSON_ONLY}`;
  const user = `Lesson topic: ${lessonPlan.topic}
Concepts taught: ${lessonPlan.sections.map((s) => s.title).join(", ")}
Focus topics: ${lessonPlan.finalQuizTopics.join(", ")}

Generate 4-6 quiz questions. Return JSON array:
[
  { "id": string, "type": "mcq"|"short", "question": string, "options": string[]|null, "correctAnswer": string, "conceptTag": string }
]`;

  // 4-6 questions with options is verbose JSON; too tight a budget here
  // truncates the response mid-array and fails to parse (observed on the
  // free-tier model chain), so give it real headroom.
  return callModelJSON<QuizQuestion[]>(system, user, 4096);
}

export async function generateReport(params: {
  lessonPlan: LessonPlan;
  quizResults: { question: QuizQuestion; studentAnswer: string; correct: boolean }[];
  checkpointResults: { conceptTag: string; correct: boolean }[];
  language: string;
}): Promise<LearningReport> {
  const { lessonPlan, quizResults, checkpointResults, language } = params;
  const system = `You produce a concise, encouraging learning report summarizing student performance across the lesson and quiz. Respond in ${language}. ${JSON_ONLY}`;
  const user = `Topic: ${lessonPlan.topic}

Checkpoint performance during lesson: ${JSON.stringify(checkpointResults)}
Quiz performance: ${JSON.stringify(
    quizResults.map((r) => ({
      question: r.question.question,
      conceptTag: r.question.conceptTag,
      correct: r.correct,
    }))
  )}

Return JSON:
{
  "topic": string,
  "scorePercent": number,
  "strongAreas": string[],
  "weakAreas": string[],
  "incorrectConcepts": string[],
  "recommendation": string,
  "suggestedNextTopic": string
}`;

  return callModelJSON<LearningReport>(system, user, 1024);
}

export async function translateSection(params: {
  section: LessonSection;
  targetLanguage: string;
}): Promise<LessonSection> {
  const { section, targetLanguage } = params;
  const system = `You translate/re-express a lesson section into a new teaching language, preserving all meaning, structure, and field names exactly. Keep code/equation/mermaid syntax valid; only translate human-readable text within them (labels, comments) when safe to do so. Target language: ${targetLanguage}. ${JSON_ONLY}`;
  const user = `Section JSON to re-express in ${targetLanguage}:
${JSON.stringify(section)}

Return the SAME JSON shape, fully in ${targetLanguage} for narration, bulletPoints, example, and checkpoint question/options. Keep ids, type fields, estimatedSeconds, conceptTags, and visual.type unchanged.`;

  return callModelJSON<LessonSection>(system, user, 2048);
}

export async function generateLearningPath(params: {
  topic: string;
  profile: LearnerProfile;
}): Promise<LearningPath> {
  const { topic, profile } = params;
  const system = `You design a structured multi-step curriculum (learning path) for a broad topic, ordered from foundational to advanced. Respond in ${profile.language}. ${JSON_ONLY}`;
  const user = `Broad topic: ${topic}
${profileBlock(profile)}

Return JSON:
{
  "topic": string,
  "steps": [ { "id": string, "title": string, "description": string } ]
}
Produce 5-10 steps.`;

  return callModelJSON<LearningPath>(system, user, 2048);
}
