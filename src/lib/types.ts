export type Level = "beginner" | "intermediate" | "advanced";

export interface LearnerProfile {
  level: Level;
  language: string;
  availableMinutes: number;
  objective?: string;
  style?: string;
  existingKnowledge?: string;
}

export type VisualType =
  | "none"
  | "markdown"
  | "equation"
  | "graph"
  | "mermaid"
  | "code"
  | "timeline";

export interface GraphSpec {
  expression: string;
  xMin: number;
  xMax: number;
  label?: string;
}

export interface TimelineEvent {
  date: string;
  event: string;
}

export interface VisualSpec {
  type: VisualType;
  content?: string;
  codeLanguage?: string;
  graph?: GraphSpec;
  timeline?: TimelineEvent[];
}

export interface CheckpointQuestion {
  id: string;
  type: "mcq" | "short" | "application";
  question: string;
  options?: string[];
  correctAnswer?: string;
  conceptTag: string;
}

export interface LessonSection {
  id: string;
  title: string;
  narration: string;
  bulletPoints: string[];
  visual: VisualSpec;
  example?: string;
  checkpoint?: CheckpointQuestion | null;
  estimatedSeconds: number;
  conceptTags: string[];
}

export interface LessonPlan {
  topic: string;
  subject: string;
  levelSummary: string;
  totalEstimatedMinutes: number;
  language: string;
  sections: LessonSection[];
  finalQuizTopics: string[];
  sourceGrounded: boolean;
}

export interface SourceChunkRef {
  chunkId: string;
  text: string;
  score: number;
}

export interface EvalResult {
  correct: boolean;
  partialCredit: number;
  misconception?: string;
  feedback: string;
  remediation?: {
    reExplanation: string;
    analogy?: string;
    extraExample?: string;
  };
}

export interface QuizQuestion {
  id: string;
  type: "mcq" | "short";
  question: string;
  options?: string[];
  correctAnswer?: string;
  conceptTag: string;
}

export interface QuizAnswer {
  questionId: string;
  answer: string;
}

export interface LearningReport {
  topic: string;
  scorePercent: number;
  strongAreas: string[];
  weakAreas: string[];
  incorrectConcepts: string[];
  recommendation: string;
  suggestedNextTopic: string;
}

export interface LearningPathStep {
  id: string;
  title: string;
  description: string;
}

export interface LearningPath {
  topic: string;
  steps: LearningPathStep[];
}

export interface DocumentSummary {
  docId: string;
  filename: string;
  numChunks: number;
  language: string;
  preview: string;
  concepts: string[];
  /**
   * Set when the document indexed fine but concept extraction failed (quota,
   * timeout). Distinguishes "no concepts found" from "couldn't look".
   */
  conceptsWarning?: string;
}

export interface TranscriptMessage {
  role: "ai" | "user";
  text: string;
}

export interface HistoryQuizAnswer {
  question: string;
  studentAnswer: string;
  correct: boolean;
}

export interface LearnerHistoryEntry {
  id: string;
  topic: string;
  date: string;
  language: string;
  subject?: string;
  scorePercent?: number;
  strongAreas: string[];
  weakAreas: string[];
  recommendation?: string;
  transcript: TranscriptMessage[];
  quiz: HistoryQuizAnswer[];
}

export interface LearnerMemory {
  /** The most recent lessons, newest first — at most `historyWindow` of them. */
  history: LearnerHistoryEntry[];
  weakConcepts: string[];
  strongConcepts: string[];
  /**
   * Lessons this learner has completed in total. `history` is a window, so
   * anything presented as a lifetime figure has to come from here — see M2 in
   * docs/REMEDIATION-LEDGER.md.
   */
  historyTotal?: number;
  /** How many entries `history` can hold. */
  historyWindow?: number;
  currentPath?: LearningPath;
  currentStepIndex?: number;
}
