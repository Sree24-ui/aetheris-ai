"use client";

import { useEffect, useState } from "react";
import type {
  LearnerProfile,
  LearningReport,
  LearningPath,
  DocumentSummary,
  TranscriptMessage,
} from "@/lib/types";
import type { LearnerPlan } from "@/lib/lessonState";
import AppShell from "@/components/AppShell";
import HomeDashboard from "@/components/HomeDashboard";
import ConfigForm from "@/components/ConfigForm";
import TeachingSession from "@/components/TeachingSession";
import QuizPanel, { type QuizOutcome } from "@/components/QuizPanel";
import ReportPanel from "@/components/ReportPanel";
import LearningPathPanel from "@/components/LearningPathPanel";
import LearnerDashboard from "@/components/LearnerDashboard";
import ProfileDashboard from "@/components/ProfileDashboard";
import SettingsDashboard from "@/components/SettingsDashboard";
import { setCurrentPath } from "@/lib/memory";
import { apiRequest, errorMessage, isSessionExpired } from "@/lib/http";

/** The shape /api/lesson/session returns for a lesson still in flight. */
interface RestoredSession {
  id: string;
  version: number;
  profile: LearnerProfile;
  plan: LearnerPlan;
  currentSectionIndex: number;
  transcript: TranscriptMessage[];
}

type Stage = "home" | "config" | "planning" | "teaching" | "quiz" | "report" | "path" | "dashboard" | "profile" | "settings";

export default function Home() {
  const [stage, setStage] = useState<Stage>("home");
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [lessonPlan, setLessonPlan] = useState<LearnerPlan | null>(null);
  /**
   * The durable lesson the server is running for this learner. Everything
   * that used to live only in this component — the plan, the position, the
   * checkpoint outcomes — now belongs to it, which is what makes a refresh
   * resume rather than restart.
   */
  const [lessonSession, setLessonSession] = useState<{ id: string; version: number } | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [report, setReport] = useState<LearningReport | null>(null);
  const [learningPath, setLearningPath] = useState<LearningPath | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingTopic, setPendingTopic] = useState<string | undefined>(undefined);
  const [pendingDoc, setPendingDoc] = useState<DocumentSummary | null>(null);
  /** The graded attempt, kept so the retry button can finish the completion. */
  const [pendingQuizOutcome, setPendingQuizOutcome] = useState<QuizOutcome | null>(null);
  /**
   * The report already generated for a given assessment.
   *
   * Retrying a failed completion used to regenerate the report every time — a
   * model call, and a charged one, to rebuild something that had already
   * succeeded. Grading happens once, the report is generated once and reused,
   * and completion itself is idempotent on the server.
   */
  const [reportForQuiz, setReportForQuiz] = useState<{ quizId: string; report: LearningReport } | null>(
    null
  );
  /**
   * H7: the id for the history row of the lesson being finished, minted once
   * and reused if the save has to be retried. A fresh UUID per attempt would
   * write a second copy of the same lesson.
   */
  const [pendingHistoryId, setPendingHistoryId] = useState<string | null>(null);
  /** Where a restored lesson left off, handed to TeachingSession on mount. */
  const [resumed, setResumed] = useState<RestoredSession | null>(null);

  // A reload asks the server what is running rather than starting over.
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ session: RestoredSession | null }>("/api/lesson/session", {
      signal: controller.signal,
    })
      .then(({ session }) => {
        if (session && session.plan.sections.length > 0) {
          setLessonSession({ id: session.id, version: session.version });
          setLessonPlan(session.plan);
          setProfile(session.profile);
          setResumed(session);
          setStage("teaching");
        }
        setRestoring(false);
      })
      .catch(() => {
        // A learner who cannot be told what is running is better off at the
        // dashboard than stuck on a spinner.
        if (!controller.signal.aborted) setRestoring(false);
      });
    return () => controller.abort();
  }, []);

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
    setPendingHistoryId(null);
    setResumed(null);
    // Remembered so returning to the form after a failure restores exactly
    // what was submitted rather than resetting to defaults.
    setPendingTopic(params.topic);
    setStage("planning");
    setError(null);
    try {
      const started = await apiRequest<{
        sessionId: string;
        version: number;
        plan: LearnerPlan;
      }>("/api/lesson/plan", {
        method: "POST",
        body: {
          ...params,
          ...(fromPathStep === null
            ? {}
            : { pathTopic: learningPath?.topic, pathStepIndex: fromPathStep }),
        },
      });
      setLessonSession({ id: started.sessionId, version: started.version });
      setLessonPlan(started.plan);
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
    finalPlan: LearnerPlan;
    transcript: TranscriptMessage[];
    version: number;
  }) {
    // Checkpoint outcomes are no longer carried back from the browser — the
    // server recorded each one as it was graded.
    setLessonPlan(result.finalPlan);
    setTranscript(result.transcript);
    setLessonSession((s) => (s ? { ...s, version: result.version } : s));
    setStage("quiz");
  }

  async function handleQuizFinished(outcome: QuizOutcome) {
    if (!lessonPlan || !lessonSession) return;
    setError(null);
    setPendingQuizOutcome(outcome);
    // Reused across retries so a repeated save is a replay, not a duplicate.
    const historyId = pendingHistoryId ?? crypto.randomUUID();
    setPendingHistoryId(historyId);
    try {
      // H10: the report is built from the lesson and the graded attempt the
      // server stored. Only their ids travel — the plan, the checkpoint
      // outcomes and the marks are not the browser's to send.
      const reportData =
        reportForQuiz?.quizId === outcome.quizId
          ? reportForQuiz.report
          : await apiRequest<LearningReport>("/api/lesson/report", {
              method: "POST",
              body: { sessionId: lessonSession.id, quizId: outcome.quizId },
            });
      setReportForQuiz({ quizId: outcome.quizId, report: reportData });
      setReport(reportData);

      // H8: history, learning-path progress and the lesson's own completion
      // commit together or not at all. This used to be three independent
      // requests, any of which could fail on its own.
      const completion = await apiRequest<{
        pathStepIndex: number | null;
        pathAdvanced: boolean;
      }>("/api/lesson/complete", {
        method: "POST",
        body: {
          sessionId: lessonSession.id,
          expectedVersion: lessonSession.version,
          quizId: outcome.quizId,
          historyId,
          report: {
            strongAreas: reportData.strongAreas,
            weakAreas: reportData.weakAreas,
            recommendation: reportData.recommendation,
          },
          transcript,
        },
      });
      if (completion.pathStepIndex !== null) setCurrentStepIndex(completion.pathStepIndex);

      setPendingHistoryId(null);
      setPendingQuizOutcome(null);
      setReportForQuiz(null);
      setLessonSession(null);
      setStage("report");
    } catch (err) {
      // The report is kept when it succeeded, so a retry resumes at the step
      // that failed rather than paying for it again. The history write and the
      // path advance are idempotent on the server, so replaying the completion
      // cannot duplicate or over-advance anything either.
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
    setTranscript([]);
    setReport(null);
    setError(null);
    setPendingTopic(undefined);
    setPendingDoc(null);
    setPendingHistoryId(null);
    setPendingQuizOutcome(null);
    setReportForQuiz(null);
    setLessonSession(null);
    setResumed(null);
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

  if (restoring) {
    return (
      <AppShell active="home" onGoHome={reset} onGoProgress={() => {}} onGoProfile={() => {}} onGoSettings={() => {}}>
        <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-4">
          <div className="relative w-12 h-12">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
            <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
          <p className="text-sm text-on-surface-variant">Checking for a lesson in progress...</p>
        </div>
      </AppShell>
    );
  }

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
          {pendingQuizOutcome && (
            <button
              onClick={() => handleQuizFinished(pendingQuizOutcome)}
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

      {stage === "teaching" && lessonPlan && lessonSession && (
        <TeachingSession
          key={lessonSession.id}
          lessonPlan={lessonPlan}
          sessionId={lessonSession.id}
          initialVersion={lessonSession.version}
          initialSectionIndex={resumed?.currentSectionIndex ?? 0}
          initialTranscript={resumed?.transcript ?? []}
          onComplete={handleTeachingComplete}
        />
      )}

      {stage === "quiz" && lessonPlan && lessonSession && (
        <div className="p-container-padding lg:p-8">
          <QuizPanel
            sessionId={lessonSession.id}
            topic={lessonPlan.topic}
            language={lessonPlan.language}
            onFinished={handleQuizFinished}
          />
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
