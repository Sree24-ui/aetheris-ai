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
import ProfileDashboard from "@/components/ProfileDashboard";
import SettingsDashboard from "@/components/SettingsDashboard";
import { addHistoryEntry, setCurrentPath, advancePath } from "@/lib/memory";
import { errorMessage, isSessionExpired } from "@/lib/http";

type Stage = "home" | "config" | "planning" | "teaching" | "quiz" | "report" | "path" | "dashboard" | "profile" | "settings";

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
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingTopic, setPendingTopic] = useState<string | undefined>(undefined);
  const [pendingDoc, setPendingDoc] = useState<DocumentSummary | null>(null);
  const [pendingQuizResults, setPendingQuizResults] = useState<
    { question: QuizQuestion; studentAnswer: string; correct: boolean }[] | null
  >(null);
  /**
   * H8: which learning-path step the lesson in progress belongs to, or null
   * when it is a standalone lesson. Completion used to advance whatever path
   * happened to be active, so finishing an unrelated lesson skipped a step of
   * a curriculum the learner was not even working through.
   */
  const [activePathStep, setActivePathStep] = useState<number | null>(null);
  /**
   * H7: the id for the history row of the lesson being finished, minted once
   * and reused if the save has to be retried. A fresh UUID per attempt would
   * write a second copy of the same lesson.
   */
  const [pendingHistoryId, setPendingHistoryId] = useState<string | null>(null);

  function goToConfig(params: { topic: string; doc?: DocumentSummary }) {
    setPendingTopic(params.topic);
    setPendingDoc(params.doc ?? null);
    setError(null);
    setStage("config");
  }

  async function startLesson(
    params: { topic: string; profile: LearnerProfile; docId?: string },
    fromPathStep: number | null = null
  ) {
    setProfile(params.profile);
    setActivePathStep(fromPathStep);
    setPendingHistoryId(null);
    // Remembered so returning to the form after a failure restores exactly
    // what was submitted rather than resetting to defaults.
    setPendingTopic(params.topic);
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
      setError(describe(err));
      setStage("config");
    }
  }

  async function startLearningPath(params: { topic: string; profile: LearnerProfile }) {
    setProfile(params.profile);
    setPendingTopic(params.topic);
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
      setCurrentStepIndex(0);
      await setCurrentPath(data, 0);
      setStage("path");
    } catch (err) {
      setError(describe(err));
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
    // Reused across retries so a repeated save is a replay, not a duplicate.
    const historyId = pendingHistoryId ?? crypto.randomUUID();
    setPendingHistoryId(historyId);
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
      await addHistoryEntry({
        id: historyId,
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
      // Only a lesson that came from a path step moves the path, and only
      // from the step it belonged to — the server refuses anything else.
      if (activePathStep !== null) {
        const position = await advancePath(activePathStep);
        setCurrentStepIndex(position.stepIndex);
        setActivePathStep(null);
      }
      setPendingHistoryId(null);
      setStage("report");
    } catch (err) {
      // The report itself may have succeeded; the retry button re-runs this
      // whole function, and both the history write and the path advance are
      // idempotent, so replaying it cannot duplicate or over-advance anything.
      setError(describe(err));
    }
  }

  /** Turns any thrown value into a sentence, with a nudge when it is fixable. */
  function describe(err: unknown): string {
    if (isSessionExpired(err)) {
      return "Your session has expired. Open the sign-in page in another tab, sign in, then retry.";
    }
    return errorMessage(err);
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
    setActivePathStep(null);
    setPendingHistoryId(null);
    setPendingQuizResults(null);
  }

  async function handleSelectPathStep(stepTitle: string, index: number) {
    if (!profile || !learningPath) return;
    try {
      const position = await setCurrentPath(learningPath, index);
      setCurrentStepIndex(position.stepIndex);
      // The lesson is started with the step it belongs to, so completing it
      // advances that step and nothing else.
      startLesson({ topic: `${learningPath.topic} — ${stepTitle}`, profile }, position.stepIndex);
    } catch (err) {
      setError(describe(err));
    }
  }

  const activeNav =
    stage === "dashboard"
      ? "progress"
      : stage === "profile"
        ? "profile"
        : stage === "settings"
          ? "settings"
          : stage === "home"
            ? "home"
            : "other";

  return (
    <AppShell
      active={activeNav}
      onGoHome={reset}
      onGoProgress={() => setStage("dashboard")}
      onGoProfile={() => setStage("profile")}
      onGoSettings={() => setStage("settings")}
    >
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
          initialProfile={profile}
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
            currentStepIndex={currentStepIndex}
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

      {stage === "profile" && (
        <div className="p-container-padding lg:p-8">
          <ProfileDashboard onClose={reset} />
        </div>
      )}

      {stage === "settings" && (
        <div className="p-container-padding lg:p-8">
          <SettingsDashboard onGoProfile={() => setStage("profile")} />
        </div>
      )}
    </AppShell>
  );
}
