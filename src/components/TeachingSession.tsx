"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LessonPlan, LessonSection, EvalResult, TranscriptMessage, VisualType } from "@/lib/types";
import { useSpeech } from "@/hooks/useSpeech";
import Avatar from "./Avatar";
import SlideRenderer from "./SlideRenderer";
import VideoRecorder from "./VideoRecorder";
import VoiceSettings from "./VoiceSettings";
import Icon from "./Icon";
import { LANGUAGES } from "@/lib/languages";
import { mapWithConcurrency } from "@/lib/concurrency";
import { TRANSLATE_CONCURRENCY } from "@/lib/appConfig";
import {
  getVoicePrefsServerSnapshot,
  getVoicePrefsSnapshot,
  setVoicePrefs,
  subscribeVoicePrefs,
  type VoicePrefs,
} from "@/lib/voicePrefs";

const VISUAL_ICON: Record<VisualType, string> = {
  equation: "functions",
  graph: "show_chart",
  mermaid: "schema",
  code: "code",
  timeline: "timeline",
  markdown: "notes",
  none: "notes",
};

interface Props {
  lessonPlan: LessonPlan;
  onComplete: (result: {
    checkpointResults: { conceptTag: string; correct: boolean }[];
    finalPlan: LessonPlan;
    transcript: TranscriptMessage[];
  }) => void;
}

type Phase = "narrating" | "checkpoint" | "evaluating" | "remediation" | "done";
type PanelTab = "lesson" | "chat";

interface ChatMessage {
  id: string;
  role: "ai" | "user";
  text: string;
}

export default function TeachingSession({ lessonPlan, onComplete }: Props) {
  const [sections, setSections] = useState<LessonSection[]>(lessonPlan.sections);
  const [language, setLanguage] = useState(lessonPlan.language);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("narrating");
  const [answer, setAnswer] = useState("");
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [checkpointResults, setCheckpointResults] = useState<
    { conceptTag: string; correct: boolean }[]
  >([]);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [playToken, setPlayToken] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [showCaptions, setShowCaptions] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  // --- Feature: adjustable narration voice -------------------------------
  // Backed by localStorage through an external store, so the server renders
  // the defaults and React swaps in the saved preference after hydration.
  const voicePrefs = useSyncExternalStore(
    subscribeVoicePrefs,
    getVoicePrefsSnapshot,
    getVoicePrefsServerSnapshot
  );
  const updateVoicePrefs = useCallback((next: VoicePrefs) => setVoicePrefs(next), []);

  // --- Feature: free-form chat with the teacher --------------------------
  // Deliberately separate state from `messages` (the lesson transcript):
  // questions the student asks must not be graded, must not appear in the
  // report, and must stay available even while a checkpoint is open.
  const [panelTab, setPanelTab] = useState<PanelTab>("lesson");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatPending, setChatPending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [unreadChat, setUnreadChat] = useState(0);

  const { speak, stop, pause, resume, mouthOpen, state: speechState, voicesForLanguage } =
    useSpeech(voicePrefs);

  const sectionsRef = useRef(sections);
  const languageRef = useRef(language);
  const handledRef = useRef(false);
  const msgIdRef = useRef(0);
  const startedForRef = useRef<string | null>(null);
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const chatMessagesRef = useRef<ChatMessage[]>(chatMessages);
  messagesRef.current = messages;
  chatMessagesRef.current = chatMessages;
  sectionsRef.current = sections;
  languageRef.current = language;

  const section = sections[index];

  function addMessage(role: ChatMessage["role"], text: string) {
    msgIdRef.current += 1;
    setMessages((prev) => [...prev, { id: `m${msgIdRef.current}`, role, text }]);
  }

  // Clearing the badge here rather than in an effect keyed on `panelTab`:
  // reacting to the tab change would be a setState triggered by render.
  function openTab(tab: PanelTab) {
    setPanelTab(tab);
    if (tab === "chat") setUnreadChat(0);
  }

  function addChatMessage(role: ChatMessage["role"], text: string) {
    msgIdRef.current += 1;
    setChatMessages((prev) => [...prev, { id: `c${msgIdRef.current}`, role, text }]);
  }

  useEffect(() => {
    if (panelTab === "lesson") {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, panelTab]);

  useEffect(() => {
    if (panelTab === "chat") {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [chatMessages, panelTab]);

  // Esc (or the browser's own fullscreen UI) exits fullscreen without going
  // through our button, which would otherwise leave the icon showing the
  // wrong state. Track the document instead of assuming our click is the
  // only way in and out.
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    // React Strict Mode (dev only) invokes effects twice on mount to surface
    // impurities; without this guard that double-invocation would speak the
    // narration twice and push duplicate chat messages.
    const runKey = `${index}:${playToken}`;
    if (startedForRef.current === runKey) return;
    startedForRef.current = runKey;

    let cancelled = false;
    const sec = sectionsRef.current[index];
    if (!sec) return;
    setPhase("narrating");
    setEvalResult(null);
    setAnswer("");
    handledRef.current = false;
    const textToSpeak = [sec.narration, sec.example ? `For example: ${sec.example}` : ""]
      .filter(Boolean)
      .join(" ");
    addMessage("ai", sec.narration + (sec.example ? `\n\nExample: ${sec.example}` : ""));
    speak(textToSpeak, languageRef.current).then(() => {
      if (cancelled || handledRef.current) return;
      handledRef.current = true;
      if (sec.checkpoint) {
        setPhase("checkpoint");
        addMessage("ai", sec.checkpoint.question);
      } else {
        goNext();
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, playToken]);

  function handleSkipNarration() {
    if (handledRef.current) return;
    handledRef.current = true;
    stop();
    if (section.checkpoint) {
      setPhase("checkpoint");
      addMessage("ai", section.checkpoint.question);
    } else {
      goNext();
    }
  }

  function goNext(resultsOverride?: { conceptTag: string; correct: boolean }[]) {
    stop();
    if (index + 1 >= sectionsRef.current.length) {
      setPhase("done");
      onComplete({
        checkpointResults: resultsOverride ?? checkpointResults,
        finalPlan: { ...lessonPlan, sections: sectionsRef.current, language: languageRef.current },
        transcript: messagesRef.current.map(({ role, text }) => ({ role, text })),
      });
    } else {
      setIndex((i) => i + 1);
    }
  }

  async function handleSubmitAnswer() {
    if (!section.checkpoint || !answer.trim()) return;
    addMessage("user", answer);
    setSubmitting(true);
    setPhase("evaluating");
    try {
      const res = await fetch("/api/lesson/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: section.checkpoint,
          studentAnswer: answer,
          sectionContext: section.narration,
          language,
        }),
      });
      const resultData = await res.json();
      if (!res.ok) throw new Error(resultData.error || "Evaluation failed");
      const result: EvalResult = resultData;
      setEvalResult(result);
      // Computed explicitly (not read back from state) so the immediate
      // goNext() below — which can be the lesson's very last section —
      // always includes this result. Reading `checkpointResults` from the
      // enclosing closure would still see the pre-update value here, since
      // the setCheckpointResults above only takes effect on the next render.
      const updatedCheckpointResults = [
        ...checkpointResults,
        { conceptTag: section.checkpoint!.conceptTag, correct: result.correct },
      ];
      setCheckpointResults(updatedCheckpointResults);

      if (result.correct || result.partialCredit >= 0.7) {
        addMessage("ai", result.feedback);
        await speak(result.feedback, language);
        goNext(updatedCheckpointResults);
      } else {
        setPhase("remediation");
        const remediationText = [
          result.feedback,
          result.remediation?.reExplanation,
          result.remediation?.analogy ? `Think of it like this: ${result.remediation.analogy}` : "",
          result.remediation?.extraExample ? `Another example: ${result.remediation.extraExample}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        addMessage("ai", remediationText);
        await speak(remediationText, language);
      }
    } catch (err) {
      // Land back on "checkpoint" (not left stuck on "evaluating") so the
      // question + answer input reappear alongside this error, letting the
      // student retry immediately instead of hitting a dead end. The real
      // reason (quota, timeout) now comes through from the route.
      setPhase("checkpoint");
      setEvalResult({
        correct: false,
        partialCredit: 0,
        feedback:
          (err as Error).message ||
          "Could not reach the AI teacher to check that answer — please try submitting again.",
        misconception: undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAskQuestion(text?: string) {
    const question = (text ?? chatInput).trim();
    if (!question || chatPending) return;
    addChatMessage("user", question);
    setChatInput("");
    setFollowUps([]);
    setChatError(null);
    setChatPending(true);
    try {
      const res = await fetch("/api/lesson/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          lessonTopic: lessonPlan.topic,
          sectionTitle: section?.title ?? "",
          sectionContext: section?.narration ?? "",
          language,
          history: chatMessagesRef.current.slice(-6).map(({ role, text }) => ({ role, text })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reach the AI teacher.");
      addChatMessage("ai", data.answer);
      setFollowUps(Array.isArray(data.suggestedFollowUps) ? data.suggestedFollowUps : []);
      if (panelTab !== "chat") setUnreadChat((n) => n + 1);
    } catch (err) {
      setChatError((err as Error).message);
    } finally {
      setChatPending(false);
    }
  }

  async function handleLanguageChange(newLang: string) {
    if (newLang === language) return;
    stop();
    setTranslating(true);
    setTranslateError(null);
    try {
      const updated = [...sectionsRef.current];
      const remaining = updated.slice(index);
      // Windowed rather than all-at-once: see TRANSLATE_CONCURRENCY above.
      const settled = await mapWithConcurrency(remaining, TRANSLATE_CONCURRENCY, async (sec, offset) => {
        try {
          const res = await fetch("/api/lesson/translate-section", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ section: sec, targetLanguage: newLang }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            return { i: index + offset, section: null, error: data.error as string | undefined };
          }
          return { i: index + offset, section: await res.json(), error: undefined };
        } catch {
          return { i: index + offset, section: null, error: undefined };
        }
      });

      const failures = settled.filter((r) => r.section === null);
      for (const r of settled) {
        if (r.section) updated[r.i] = r.section;
      }
      setSections(updated);
      setLanguage(newLang);
      setPlayToken((t) => t + 1);
      if (failures.length > 0) {
        // Surface the API's own explanation (quota, rate limit) rather than
        // only a count, so the learner knows whether retrying will help.
        const reason = failures.find((f) => f.error)?.error;
        setTranslateError(
          `${failures.length} of ${settled.length} sections stayed in the original language.` +
            (reason ? ` ${reason}` : "")
        );
      }
    } finally {
      setTranslating(false);
    }
  }

  function togglePlayPause() {
    if (speechState === "speaking") {
      pause();
    } else if (speechState === "paused") {
      resume();
    } else {
      // Idle: narration already finished. Previously this did nothing at all,
      // leaving a play button that looked enabled but was inert. Re-read the
      // current text instead (the question once we're at the checkpoint).
      const sec = sectionsRef.current[index];
      if (!sec) return;
      const text =
        phase === "checkpoint" || phase === "evaluating"
          ? sec.checkpoint?.question
          : [sec.narration, sec.example ? `For example: ${sec.example}` : ""].filter(Boolean).join(" ");
      if (text) speak(text, languageRef.current);
    }
  }

  async function toggleFullscreen() {
    if (!videoFrameRef.current) return;
    // State is set by the fullscreenchange listener above, so it stays correct
    // even when the request is rejected or the user leaves another way.
    if (!document.fullscreenElement) {
      await videoFrameRef.current.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  }

  if (!section) return null;

  const progress = Math.round(((index + (phase === "done" ? 1 : 0)) / sections.length) * 100);
  const isAnswering = phase === "checkpoint" || phase === "evaluating";

  return (
    <div className="flex flex-col xl:flex-row gap-6 px-4 sm:px-6 lg:px-8 py-6 xl:h-[calc(100vh-var(--app-shell-offset,5rem))] xl:overflow-hidden">
      <div className="flex-1 flex flex-col gap-5 min-w-0 xl:overflow-y-auto xl:pr-1">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="glass-panel rounded-full h-3 w-full overflow-hidden">
              <div
                className="h-full liquid-tube rounded-full"
                style={{ ["--progress" as string]: `${progress}%` }}
              />
            </div>
            <div className="text-xs text-on-surface-variant mt-1.5">
              Section {index + 1} of {sections.length} · {lessonPlan.subject}
            </div>
          </div>

          <VoiceSettings
            prefs={voicePrefs}
            onChange={updateVoicePrefs}
            voices={voicesForLanguage(language)}
            onPreview={(text) => speak(text, language)}
            onStopPreview={stop}
            disabled={translating}
          />

          <select
            className="text-xs rounded-full glass-bubble px-3 py-2 bg-transparent text-on-surface"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            disabled={translating}
            aria-label="Teaching language"
          >
            {LANGUAGES.map((l) => (
              <option className="bg-surface-container-high" key={l} value={l}>{l}</option>
            ))}
          </select>
          <VideoRecorder />
        </div>

        {translating && (
          <div className="text-xs text-primary-fixed-dim">Switching language, keeping lesson context...</div>
        )}
        {translateError && !translating && (
          <div className="text-xs text-error">{translateError}</div>
        )}

        {/* Controls sit in normal flow below the stage rather than absolutely
            over it: with `pb-20` reservation alone, a tall caption on a short
            viewport grew straight under the buttons and they covered the
            words. Flow layout makes overlap structurally impossible. */}
        <div
          ref={videoFrameRef}
          className="glass-panel rounded-2xl flex-1 relative overflow-hidden min-h-[340px] sm:min-h-[440px] flex flex-col items-center gap-4 p-6"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary-container/10 via-transparent to-secondary-container/10" />

          <div className="relative z-10 flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-5">
            <div className="flex-1 min-h-0 w-full flex items-center justify-center">
              <Avatar speaking={speechState === "speaking"} mouthOpen={mouthOpen} />
            </div>

            {showCaptions && (
              <div className="w-full flex justify-center px-2 min-h-0">
                <div className="glass-panel px-6 py-4 rounded-2xl max-w-2xl max-h-32 overflow-y-auto text-center">
                  <p className="font-body-md text-on-surface text-sm leading-relaxed">
                    {phase === "checkpoint" || phase === "evaluating"
                      ? section.checkpoint?.question
                      : section.narration}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="relative shrink-0 flex gap-3 z-10">
            <button
              onClick={togglePlayPause}
              aria-label={speechState === "speaking" ? "Pause narration" : "Play narration"}
              className="bg-surface-variant/80 p-3 rounded-full backdrop-blur-md hover:bg-primary-container/50 transition-colors text-primary"
            >
              <Icon name={speechState === "speaking" ? "pause" : "play_arrow"} />
            </button>
            <button
              onClick={() => setShowCaptions((c) => !c)}
              aria-label={showCaptions ? "Hide captions" : "Show captions"}
              aria-pressed={showCaptions}
              className={`p-3 rounded-full backdrop-blur-md transition-colors ${
                showCaptions ? "bg-primary-container/50 text-primary" : "bg-surface-variant/80 text-primary"
              }`}
            >
              <Icon name="closed_caption" />
            </button>
            <button
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="bg-surface-variant/80 p-3 rounded-full backdrop-blur-md hover:bg-primary-container/50 transition-colors text-primary"
            >
              <Icon name={fullscreen ? "fullscreen_exit" : "fullscreen"} />
            </button>
          </div>
        </div>

        <div className="glass-panel rounded-2xl p-6 max-h-80 overflow-y-auto">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="font-headline-md text-[17px] text-on-surface flex items-center gap-2">
              {section.title}
            </h3>
            {section.visual && section.visual.type !== "none" && (
              <span className="flex items-center gap-1 text-xs text-on-surface-variant whitespace-nowrap">
                <Icon name={VISUAL_ICON[section.visual.type] ?? "notes"} className="text-[16px]" />
                Visual aid
              </span>
            )}
          </div>
          {section.bulletPoints?.length > 0 && (
            <ul className="list-disc list-inside text-sm space-y-1.5 text-on-surface-variant mb-5">
              {section.bulletPoints.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {section.visual && section.visual.type !== "none" && (
            <div className="rounded-xl bg-surface-container-lowest/50 p-5 overflow-x-auto">
              <SlideRenderer visual={section.visual} />
            </div>
          )}
          {phase === "narrating" && (
            <button
              onClick={handleSkipNarration}
              className="mt-4 text-xs text-on-surface-variant hover:text-tertiary-fixed-dim underline"
            >
              Skip narration
            </button>
          )}
        </div>
      </div>

      <div className="w-full xl:w-[26rem] shrink-0 glass-panel rounded-2xl flex flex-col overflow-hidden xl:max-h-full">
        <div
          className="flex border-b border-white/10 bg-surface-container-low/50 backdrop-blur-md"
          role="tablist"
        >
          {([
            { id: "lesson" as const, label: "Lesson", icon: "school" },
            { id: "chat" as const, label: "Ask teacher", icon: "forum" },
          ]).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={panelTab === t.id}
              onClick={() => openTab(t.id)}
              className={`flex-1 px-4 py-3.5 text-sm font-medium flex items-center justify-center gap-2 transition-colors border-b-2 ${
                panelTab === t.id
                  ? "border-b-primary text-primary bg-white/5"
                  : "border-b-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              <Icon name={t.icon} className="text-[18px]" />
              {t.label}
              {t.id === "chat" && unreadChat > 0 && (
                <span className="ml-0.5 min-w-5 h-5 px-1.5 rounded-full bg-primary text-on-primary text-[11px] font-semibold flex items-center justify-center">
                  {unreadChat}
                </span>
              )}
            </button>
          ))}
        </div>

        {panelTab === "lesson" ? (
          <>
            <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 min-h-[240px] max-h-[45vh] xl:max-h-none">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-2xl p-bubble-padding max-w-[90%] whitespace-pre-line text-sm leading-relaxed ${
                    m.role === "ai"
                      ? "glass-panel rounded-tl-sm border-l-2 border-l-primary self-start text-on-surface"
                      : "bg-secondary-container/20 rounded-tr-sm border border-secondary/20 self-end text-secondary-fixed"
                  }`}
                >
                  {m.text}
                </div>
              ))}
              <div ref={transcriptEndRef} />
            </div>

            <div className="p-4 bg-surface-container-low/50 backdrop-blur-md border-t border-white/10 flex flex-col gap-3">
              {isAnswering && section.checkpoint?.type === "mcq" && section.checkpoint.options ? (
                <div className="grid gap-2">
                  {section.checkpoint.options.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAnswer(opt)}
                      disabled={submitting}
                      className={`text-left text-sm px-3.5 py-2.5 rounded-xl glass-bubble ${answer === opt ? "active" : ""}`}
                    >
                      {opt}
                    </button>
                  ))}
                  <button
                    onClick={handleSubmitAnswer}
                    disabled={!answer.trim() || submitting}
                    className="mt-1 px-4 py-2.5 rounded-full bg-primary-container text-on-primary-container text-sm font-medium disabled:opacity-40"
                  >
                    {submitting ? "Checking..." : "Submit answer"}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-surface-variant/50 border border-outline/30 rounded-full px-4 py-2.5 font-body-md text-sm text-on-surface focus:outline-none focus:border-primary/50 disabled:opacity-40"
                    placeholder={isAnswering ? "Type your answer..." : "Waiting for the next question..."}
                    value={answer}
                    disabled={!isAnswering || submitting}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmitAnswer()}
                    aria-label="Your answer"
                  />
                  <button
                    onClick={handleSubmitAnswer}
                    disabled={!isAnswering || !answer.trim() || submitting}
                    aria-label="Submit answer"
                    className="p-2.5 text-primary hover:text-tertiary-fixed-dim transition-colors disabled:opacity-30"
                  >
                    <Icon name="send" />
                  </button>
                </div>
              )}

              {/* When the lesson is not asking anything, point the learner at
                  the chat tab instead of leaving a dead input as the only
                  affordance on screen. */}
              {!isAnswering && phase !== "done" && (
                <button
                  onClick={() => openTab("chat")}
                  className="text-xs text-on-surface-variant hover:text-primary underline self-start"
                >
                  Have a question? Ask the teacher →
                </button>
              )}

              {evalResult && (phase === "remediation" || phase === "checkpoint") && (
                <div
                  className={`text-xs rounded-xl p-3.5 border ${
                    evalResult.correct ? "bg-secondary/10 border-secondary/30" : "bg-tertiary/10 border-tertiary/30"
                  }`}
                >
                  <div className="font-medium mb-1">{evalResult.correct ? "✓ Correct" : "Let's fix this misconception"}</div>
                  {evalResult.misconception && (
                    <p className="text-on-surface-variant">Misconception: {evalResult.misconception}</p>
                  )}
                  {phase === "remediation" && (
                    <button
                      onClick={() => goNext()}
                      className="mt-2 px-4 py-1.5 rounded-full bg-primary-container text-on-primary-container text-xs"
                    >
                      Continue lesson
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 min-h-[240px] max-h-[45vh] xl:max-h-none">
              {chatMessages.length === 0 && !chatPending && (
                <div className="m-auto text-center px-4 py-8 flex flex-col items-center gap-3">
                  <Icon name="forum" className="text-4xl text-outline" />
                  <p className="text-sm text-on-surface-variant max-w-[16rem]">
                    Ask anything about this lesson — a definition, a step you missed, or a &ldquo;why
                    does that work?&rdquo;. This is separate from your checkpoints and is never graded.
                  </p>
                </div>
              )}
              {chatMessages.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-2xl p-bubble-padding max-w-[90%] whitespace-pre-line text-sm leading-relaxed ${
                    m.role === "ai"
                      ? "glass-panel rounded-tl-sm border-l-2 border-l-tertiary self-start text-on-surface"
                      : "bg-secondary-container/20 rounded-tr-sm border border-secondary/20 self-end text-secondary-fixed"
                  }`}
                >
                  {m.text}
                </div>
              ))}
              {chatPending && (
                <div className="glass-panel rounded-2xl rounded-tl-sm border-l-2 border-l-tertiary self-start px-4 py-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse" />
                  <span className="text-xs text-on-surface-variant">Thinking...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 bg-surface-container-low/50 backdrop-blur-md border-t border-white/10 flex flex-col gap-3">
              {chatError && (
                <div className="text-xs text-error bg-error-container/20 border border-error/30 rounded-lg p-2.5">
                  {chatError}
                </div>
              )}

              {followUps.length > 0 && !chatPending && (
                <div className="flex flex-wrap gap-2">
                  {followUps.map((f) => (
                    <button
                      key={f}
                      onClick={() => handleAskQuestion(f)}
                      className="text-xs px-3 py-1.5 rounded-full glass-bubble text-on-surface-variant hover:text-on-surface text-left"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  className="flex-1 bg-surface-variant/50 border border-outline/30 rounded-full px-4 py-2.5 font-body-md text-sm text-on-surface focus:outline-none focus:border-tertiary/50 disabled:opacity-40"
                  placeholder="Ask the teacher anything..."
                  value={chatInput}
                  disabled={chatPending}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAskQuestion()}
                  aria-label="Ask the teacher a question"
                />
                <button
                  onClick={() => handleAskQuestion()}
                  disabled={!chatInput.trim() || chatPending}
                  aria-label="Send question"
                  className="p-2.5 text-tertiary hover:text-tertiary-fixed-dim transition-colors disabled:opacity-30"
                >
                  <Icon name="send" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
