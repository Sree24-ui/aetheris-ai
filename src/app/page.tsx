"use client";

import { useState } from "react";
import type {
  LearnerProfile,
  LessonPlan,
  QuizQuestion,
  LearningReport,
  LearningPath,
  DocumentSummary,
  TranscriptMessage,
} from "@/lib/types";
import AppShell from "@/components/AppShell";
import HomeDashboard from "@/components/HomeDashboard";
import ConfigForm from "@/components/ConfigForm";
import TeachingSession from "@/components/TeachingSession";
import QuizPanel from "@/components/QuizPanel";
import ReportPanel from "@/components/ReportPanel";
import LearningPathPanel from "@/components/LearningPathPanel";
import LearnerDashboard from "@/components/LearnerDashboard";
import { addHistoryEntry, setCurrentPath, advancePath, loadMemory } from "@/lib/memory";

type Stage = "home" | "config" | "planning" | "teaching" | "quiz" | "report" | "path" | "dashboard";

export default function Home() {
  const [stage, setStage] = useState<Stage>("home");
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [lessonPlan, setLessonPlan] = useState<LessonPlan | null>(null);
  const [checkpointResults, setCheckpointResults] = useState<
    { conceptTag: string; correct: boolean }[]
  >([]);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [report, setReport] = useState<LearningReport | null>(null);
  const [learningPath, setLearningPath] = useState<LearningPath | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTopic, setPendingTopic] = useState<string | undefined>(undefined);
  const [pendingDoc, setPendingDoc] = useState<DocumentSummary | null>(null);
  const [pendingQuizResults, setPendingQuizResults] = useState<
    { question: QuizQuestion; studentAnswer: string; correct: boolean }[] | null
  >(null);

  function goToConfig(params: { topic: string; doc?: DocumentSummary }) {
    setPendingTopic(params.topic);
    setPendingDoc(params.doc ?? null);
    setError(null);
    setStage("config");
  }

  async function startLesson(params: { topic: string; profile: LearnerProfile; docId?: string }) {
    setProfile(params.profile);
    setStage("planning");
    setError(null);
    try {
      const res = await fetch("/api/lesson/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to plan lesson");
      setLessonPlan(data);
      setCheckpointResults([]);
      setStage("teaching");
    } catch (err) {
      setError((err as Error).message);
      setStage("config");
    }
  }

  async function startLearningPath(params: { topic: string; profile: LearnerProfile }) {
    setProfile(params.profile);
    setStage("planning");
    setError(null);
    try {
      const res = await fetch("/api/learning-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate the learning path");
      setLearningPath(data);
      setCurrentPath(data, 0);
      setStage("path");
    } catch (err) {
      setError((err as Error).message);
      setStage("config");
    }
  }

  function handleTeachingComplete(result: {
    checkpointResults: { conceptTag: string; correct: boolean }[];
    finalPlan: LessonPlan;
    transcript: TranscriptMessage[];
  }) {
    setCheckpointResults(result.checkpointResults);
    setLessonPlan(result.finalPlan);
    setTranscript(result.transcript);
    setStage("quiz");
  }

  async function handleQuizFinished(
    results: { question: QuizQuestion; studentAnswer: string; correct: boolean }[]
  ) {
    if (!lessonPlan) return;
    setError(null);
    setPendingQuizResults(results);
    try {
      const res = await fetch("/api/lesson/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lessonPlan,
          quizResults: results,
          checkpointResults,
          language: lessonPlan.language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate the learning report");
      const reportData: LearningReport = data;
      setReport(reportData);
      setPendingQuizResults(null);
      addHistoryEntry({
        id: crypto.randomUUID(),
        topic: lessonPlan.topic,
        date: new Date().toISOString(),
        language: lessonPlan.language,
        subject: lessonPlan.subject,
        scorePercent: reportData.scorePercent,
        strongAreas: reportData.strongAreas,
        weakAreas: reportData.weakAreas,
        recommendation: reportData.recommendation,
        transcript,
        quiz: results.map((r) => ({
          question: r.question.question,
          studentAnswer: r.studentAnswer,
          correct: r.correct,
        })),
      });
      const mem = loadMemory();
      if (mem.currentPath) advancePath();
      setStage("report");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function reset() {
    setStage("home");
    setLessonPlan(null);
    setReport(null);
    setCheckpointResults([]);
    setTranscript([]);
    setError(null);
    setPendingTopic(undefined);
    setPendingDoc(null);
  }

  function handleSelectPathStep(stepTitle: string, index: number) {
    if (!profile || !learningPath) return;
    setCurrentPath(learningPath, index);
    startLesson({ topic: `${learningPath.topic} — ${stepTitle}`, profile });
  }

  const activeNav = stage === "dashboard" ? "progress" : stage === "home" ? "home" : "other";

  return (
    <AppShell active={activeNav} onGoHome={reset} onGoProgress={() => setStage("dashboard")}>
      {error && (
        <div className="max-w-2xl mx-auto mt-6 text-sm text-error bg-error-container/20 border border-error/30 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
          <span>{error}</span>
          {pendingQuizResults && (
            <button
              onClick={() => handleQuizFinished(pendingQuizResults)}
              className="px-3 py-1.5 rounded-full bg-error-container/40 border border-error/40 text-xs font-medium whitespace-nowrap"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {stage === "home" && (
        <HomeDashboard
          onProceed={goToConfig}
          onRevise={(topic) => goToConfig({ topic })}
        />
      )}

      {stage === "config" && (
        <ConfigForm
          initialTopic={pendingTopic}
          initialDoc={pendingDoc}
          onSubmit={startLesson}
          onLearningPath={startLearningPath}
          onBack={reset}
        />
      )}

      {stage === "planning" && (
        <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-4">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <p className="text-sm text-on-surface-variant">Understanding the material and planning your lesson...</p>
        </div>
      )}

      {stage === "path" && learningPath && (
        <div className="p-container-padding lg:p-8">
          <LearningPathPanel
            path={learningPath}
            currentStepIndex={loadMemory().currentStepIndex ?? 0}
            onSelectStep={handleSelectPathStep}
            onBack={reset}
          />
        </div>
      )}

      {stage === "teaching" && lessonPlan && (
        <TeachingSession lessonPlan={lessonPlan} onComplete={handleTeachingComplete} />
      )}

      {stage === "quiz" && lessonPlan && (
        <div className="p-container-padding lg:p-8">
          <QuizPanel lessonPlan={lessonPlan} language={lessonPlan.language} onFinished={handleQuizFinished} />
        </div>
      )}

      {stage === "report" && report && (
        <ReportPanel
          report={report}
          onRestart={reset}
          onNextTopic={(topic) => profile && startLesson({ topic, profile })}
        />
      )}

      {stage === "dashboard" && (
        <div className="p-container-padding lg:p-8">
          <LearnerDashboard onClose={reset} />
        </div>
      )}
    </AppShell>
  );
}
