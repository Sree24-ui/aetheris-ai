"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LessonSection, EvalResult, TranscriptMessage, VisualType } from "@/lib/types";
import type { LearnerPlan } from "@/lib/lessonState";
import { apiRequest, errorMessage } from "@/lib/http";
import { languageToBCP47, useSpeech } from "@/hooks/useSpeech";
import Avatar from "./Avatar";
import SlideRenderer from "./SlideRenderer";
import VideoRecorder from "./VideoRecorder";
import VoiceSettings from "./VoiceSettings";
import Icon from "./Icon";
import { LANGUAGES } from "@/lib/languages";
import { mapWithConcurrency } from "@/lib/concurrency";
import { applyTranslations, translationFailure } from "@/lib/lessonTranslation";
import { STANCE_PRESENTATION, type TeachingStance } from "@/lib/adaptation";
import { AVATAR_EXPRESSIONS, avatarStateFor } from "@/lib/avatarState";
import {
  beginSection,
  narrationBody,
  narrationText,
  playCommand,
  reachCheckpoint,
  retranslateTranscript,
} from "@/lib/lessonPlayback";
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
  lessonPlan: LearnerPlan;
  /** The durable lesson this component is driving. */
  sessionId: string;
  /** The session version to send with the first command. */
  initialVersion: number;
  /** Where a restored lesson left off. */
  initialSectionIndex?: number;
  initialTranscript?: TranscriptMessage[];
  onComplete: (result: {
    finalPlan: LearnerPlan;
    transcript: TranscriptMessage[];
    version: number;
  }) => void;
}

type Phase = "narrating" | "checkpoint" | "evaluating" | "remediation" | "done";
type PanelTab = "lesson" | "chat";

interface ChatMessage {
  id: string;
  role: "ai" | "user";
  text: string;
}

export default function TeachingSession({
  lessonPlan,
  sessionId,
  initialVersion,
  initialSectionIndex = 0,
  initialTranscript = [],
  onComplete,
}: Props) {
  const [sections, setSections] = useState<LessonSection[]>(lessonPlan.sections);
  const [language, setLanguage] = useState(lessonPlan.language);
  const [index, setIndex] = useState(initialSectionIndex);
  /**
   * The session version this component believes it is acting on. Every
   * command names it, and the server refuses anything stale — which is what
   * stops a background tab or a delayed retry moving the lesson on.
   */
  const versionRef = useRef(initialVersion);
  /** Shown when progress could not be saved; never blocks the lesson. */
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("narrating");
  const [answer, setAnswer] = useState("");
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  /**
   * How the teaching is currently adapting, as the server judged it from the
   * checkpoint outcomes it recorded. Shown rather than merely applied: a
   * lesson that quietly changes register looks like an inconsistent one.
   */
  const [stance, setStance] = useState<{ stance: TeachingStance; note: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [playToken, setPlayToken] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>(
    initialTranscript.map((m, i) => ({ id: `r${i}`, role: m.role, text: m.text }))
  );
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

  const { speak, stop, pause, resume, mouthOpen, state: speechState, voicesForLanguage, canNarrate } =
    useSpeech(voicePrefs);

  const sectionsRef = useRef(sections);
  const languageRef = useRef(language);
  /**
   * Which language switch owns the UI. A switch that finishes after a newer
   * one started must not apply: the dropdown would say one language while the
   * sections said another, which reads as the switch having done nothing.
   */
  const switchGenerationRef = useRef(0);
  const translateAbortRef = useRef<AbortController | null>(null);
  const handledRef = useRef(false);
  const msgIdRef = useRef(0);
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

  // The lesson's own bubbles are keyed by section, so a replay rewrites them
  // in place rather than appending a second copy — and beginning a section
  // clears its question, so the transcript can never show one while the input
  // says the lesson is waiting for the next.

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

  /**
   * M12: generated lesson text is not in the document's language.
   * `<html lang="en">` tells a screen reader to pronounce a Hindi narration
   * with English phonetics, which is unintelligible. Every element carrying
   * lesson text gets the language it is actually written in.
   */
  const contentLang = languageToBCP47(language);

  /**
   * Navigating away mid-lesson loses the section in progress. The lesson
   * itself is durable now, but an unsaved position and an unanswered
   * checkpoint are not worth losing silently.
   */
  useEffect(() => {
    if (phase === "done") return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // Esc (or the browser's own fullscreen UI) exits fullscreen without going
  // through our button, which would otherwise leave the icon showing the
  // wrong state. Track the document instead of assuming our click is the
  // only way in and out.
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Leaving the lesson mid-switch must not leave a fan-out of translation
  // requests running, nor let one land on an unmounted component.
  useEffect(
    () => () => {
      switchGenerationRef.current += 1;
      translateAbortRef.current?.abort();
    },
    []
  );

  useEffect(() => {
    // React invokes effects twice on mount in development. This deliberately
    // has no guard against that: `speak` supersedes whatever it replaces, so
    // the second run cancels the first and only one utterance is heard, and
    // the transcript is keyed by section so the message is rewritten rather
    // than repeated. A guard that skipped the second run used to sit here, and
    // it was half of why no lesson ever narrated — it suppressed the only run
    // that happened after the speech controller had been torn down and re-armed.
    let cancelled = false;
    const sec = sectionsRef.current[index];
    if (!sec) return;
    setPhase("narrating");
    setEvalResult(null);
    setAnswer("");
    handledRef.current = false;
    const textToSpeak = narrationText(sec, "narrating");
    setMessages((prev) => beginSection(prev, index, narrationBody(sec)));
    speak(textToSpeak, languageRef.current).then((outcome) => {
      // H9: narration now reports *why* it finished. Only a real ending
      // advances the lesson — cancelling (skip, pause-then-leave, a voice
      // preview, unmount) used to be indistinguishable from finishing, which
      // is how a section could be skipped without being taught.
      if (outcome === "cancelled") return;
      if (cancelled || handledRef.current) return;
      handledRef.current = true;
      if (sec.checkpoint) {
        setPhase("checkpoint");
        setMessages((prev) => reachCheckpoint(prev, index, sec.checkpoint!.question));
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
      setMessages((prev) => reachCheckpoint(prev, index, section.checkpoint!.question));
    } else {
      goNext();
    }
  }

  /**
   * Records the lesson's position on the server.
   *
   * Deliberately non-blocking: narration must not stall because a progress
   * write is slow. A failure is surfaced rather than swallowed, and the next
   * successful command re-syncs the version.
   */
  async function syncPosition(toSectionIndex: number) {
    try {
      const { session } = await apiRequest<{ session: { version: number } }>(
        "/api/lesson/session",
        {
          method: "POST",
          body: {
            sessionId,
            expectedVersion: versionRef.current,
            command: {
              type: "advance",
              toSectionIndex,
              transcript: messagesRef.current.map(({ role, text }) => ({ role, text })),
            },
          },
        }
      );
      versionRef.current = session.version;
      setSyncWarning(null);
    } catch (err) {
      setSyncWarning(
        `Progress could not be saved (${errorMessage(err)}) — the lesson continues, but a refresh may not resume exactly here.`
      );
    }
  }

  function goNext() {
    stop();
    if (index + 1 >= sectionsRef.current.length) {
      setPhase("done");
      onComplete({
        finalPlan: { ...lessonPlan, sections: sectionsRef.current, language: languageRef.current },
        transcript: messagesRef.current.map(({ role, text }) => ({ role, text })),
        version: versionRef.current,
      });
    } else {
      const nextIndex = index + 1;
      setIndex(nextIndex);
      void syncPosition(nextIndex);
    }
  }

  async function handleSubmitAnswer() {
    if (!section.checkpoint || !answer.trim()) return;
    addMessage("user", answer);
    setSubmitting(true);
    setPhase("evaluating");
    try {
      // H10: the question, its reference answer and the section context all
      // come from the plan the server stored. This names a section; it does
      // not carry the key, and the verdict it gets back is the server's.
      const graded = await apiRequest<{
        evaluation: EvalResult;
        version: number;
        adaptation?: { stance: TeachingStance; note: string };
      }>(
        "/api/lesson/evaluate",
        {
          method: "POST",
          body: {
            sessionId,
            expectedVersion: versionRef.current,
            sectionId: section.id,
            studentAnswer: answer,
            language,
          },
        }
      );
      versionRef.current = graded.version;
      if (graded.adaptation) setStance(graded.adaptation);
      const result = graded.evaluation;
      setEvalResult(result);

      if (result.correct || result.partialCredit >= 0.7) {
        addMessage("ai", result.feedback);
        await speak(result.feedback, language);
        goNext();
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
          errorMessage(err) ||
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

  /**
   * Switches the teaching language of the whole lesson.
   *
   * Every section is translated, not just the ones still to come, and the
   * transcript's own bubbles are rewritten from the result. Translating only
   * from the current section left a lesson in two languages at once — English
   * narration above a Korean checkpoint — because the bubbles already on
   * screen were never revisited.
   *
   * What is *not* translated: the learner's own answers, and the teacher's
   * in-the-moment feedback. Those are a record of what was said, and rewriting
   * a learner's words in another language is not a thing to do silently.
   *
   * Three things have to hold for the switch to be visible: narration for the
   * old language has to stop (and release whatever was awaiting it), the
   * translated sections have to land on the lesson as it stands when they
   * arrive rather than as it was when the switch started, and a switch that
   * has been superseded has to leave the newer one alone.
   */
  async function handleLanguageChange(newLang: string) {
    if (newLang === language) return;
    // Releases the section in progress as "cancelled", which the narration
    // effect deliberately does not advance on.
    stop();

    translateAbortRef.current?.abort();
    const abort = new AbortController();
    translateAbortRef.current = abort;
    const generation = ++switchGenerationRef.current;

    setTranslating(true);
    setTranslateError(null);
    try {
      // Windowed rather than all-at-once: see TRANSLATE_CONCURRENCY above.
      const settled = await mapWithConcurrency(
        sectionsRef.current,
        TRANSLATE_CONCURRENCY,
        async (sec, index) => {
          try {
            const res = await fetch("/api/lesson/translate-section", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ section: sec, targetLanguage: newLang }),
              signal: abort.signal,
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              return { index, section: null, error: data.error as string | undefined };
            }
            return { index, section: (await res.json()) as LessonSection };
          } catch {
            return { index, section: null };
          }
        }
      );

      // A newer switch (or an unmount) owns the lesson now. Applying this
      // batch would put the previous language back underneath a dropdown
      // showing the newer one.
      if (generation !== switchGenerationRef.current) return;

      const translated = applyTranslations(sectionsRef.current, settled);
      setSections(translated);
      // The bubbles already on screen are rewritten from the same sections, so
      // the transcript and the caption cannot disagree about the language.
      setMessages((prev) => retranslateTranscript(prev, translated));
      setLanguage(newLang);
      // Replays the current section, now translated. The narration effect
      // keys on this, so it re-runs even though the index has not moved.
      setPlayToken((t) => t + 1);
      setTranslateError(translationFailure(settled));
    } finally {
      if (generation === switchGenerationRef.current) setTranslating(false);
    }
  }

  function togglePlayPause() {
    const command = playCommand({
      state: speechState,
      phase,
      section: sectionsRef.current[index],
    });
    if (command.kind === "pause") pause();
    else if (command.kind === "resume") resume();
    // Narrating: re-run the effect that owns the section, so the lesson still
    // advances when this utterance ends. Speaking directly from here started a
    // second utterance nobody was waiting on, which stalled the lesson.
    else if (command.kind === "replay") setPlayToken((t) => t + 1);
    // Parked at a checkpoint or on remediation: re-read it. Nothing waits on
    // this one, and the phase has its own way forward.
    else if (command.kind === "speak") void speak(command.text, languageRef.current);
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
  /**
   * What the teacher is doing, for the avatar. Derived rather than stored:
   * every one of these is already a fact about the lesson, and a second copy
   * of it would be a second thing that can fall out of step.
   */
  const narrationSilent = !canNarrate(language);
  const avatarState = avatarStateFor({
    speechState,
    phase,
    answeredCorrectly: evalResult?.correct ?? null,
  });

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
            <div className="text-xs text-on-surface-variant mt-1.5 flex items-center gap-2 flex-wrap">
              <span>
                Section {index + 1} of {sections.length} · {lessonPlan.subject}
              </span>
              {stance && (
                <span
                  role="status"
                  title={stance.note}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                    stance.stance === "support"
                      ? "border-tertiary/40 text-tertiary-fixed-dim"
                      : stance.stance === "stretch"
                        ? "border-secondary/40 text-secondary-fixed-dim"
                        : "border-outline/30 text-on-surface-variant"
                  }`}
                >
                  <Icon name={STANCE_PRESENTATION[stance.stance].icon} className="text-[14px]" />
                  {STANCE_PRESENTATION[stance.stance].label}
                </span>
              )}
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
        {syncWarning && (
          <div role="status" className="text-xs text-on-surface-variant">
            {syncWarning}
          </div>
        )}
        {translateError && !translating && (
          <div className="text-xs text-error">{translateError}</div>
        )}

        {narrationSilent && (
          <div className="flex items-start gap-2 text-xs text-tertiary-fixed-dim">
            <Icon name="voice_over_off" className="text-[16px] shrink-0 mt-px" />
            <span>
              No {language} voice on this device — the lesson runs without narration and
              advances at reading pace. Captions, diagrams, questions and pause/play are
              unaffected.
            </span>
          </div>
        )}

        {/* Controls sit in normal flow below the stage rather than absolutely
            over it: with `pb-20` reservation alone, a tall caption on a short
            viewport grew straight under the buttons and they covered the
            words. Flow layout makes overlap structurally impossible. */}
        <div
          ref={videoFrameRef}
          className="glass-panel rounded-2xl flex-1 relative overflow-hidden min-h-[340px] sm:min-h-[440px] flex flex-col items-center gap-4 p-6"
        >
          {/* The room behind the teacher: a faint board ruling and a warm
              wash, so the stage reads as somewhere a class happens rather than
              as an empty panel. Purely decorative, and behind everything. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-primary-container/10 via-transparent to-secondary-container/10"
          />
          <div aria-hidden className="absolute inset-0 teaching-board-grid opacity-[0.35]" />

          {/* What the teacher is doing, in one word, where a viewer's eye
              already is. The lesson's own adaptation chip stays in the header;
              this is only the teacher's current activity. */}
          <div className="relative z-10 self-start flex items-center gap-2 text-[11px] text-on-surface-variant">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                speechState === "speaking" ? "bg-primary animate-pulse" : "bg-outline"
              }`}
            />
            <span role="status">
              {narrationSilent && speechState === "speaking"
                ? "Silent narration"
                : AVATAR_EXPRESSIONS[avatarState].status}
            </span>
          </div>

          <div className="relative z-10 flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-5">
            <div className="flex-1 min-h-0 w-full flex items-center justify-center">
              <Avatar state={avatarState} mouthOpen={mouthOpen} silent={narrationSilent} />
            </div>

            {showCaptions && (
              <div className="w-full flex justify-center px-2 min-h-0">
                <div className="glass-panel px-6 py-4 rounded-2xl max-w-2xl max-h-32 overflow-y-auto text-center">
                  {/* Captions follow the narration, so they are announced as
                      they change rather than only on request. */}
                  <p
                    lang={contentLang}
                    aria-live="polite"
                    className="font-body-md text-on-surface text-sm leading-relaxed"
                  >
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

        {/* The visual aid is a teaching surface, not a preview strip. The card
            is sized by its content between a floor that fits an ordinary
            diagram and a ceiling that keeps the stage above it on screen;
            only genuinely oversized content scrolls inside it. */}
        <div className="glass-panel rounded-2xl p-6 pt-5 min-h-[18rem] max-h-[min(72vh,44rem)] overflow-y-auto border-t-2 border-t-primary/30">
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary-fixed-dim mb-2">
            <Icon name="co_present" className="text-[14px]" />
            Teaching board
          </div>
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
            <div className="rounded-xl bg-surface-container-lowest/50 p-5 overflow-x-auto min-h-[13rem] sm:min-h-[16rem]">
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
            <div
              lang={contentLang}
              className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 min-h-[240px] max-h-[45vh] xl:max-h-none"
            >
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
                  <div className="font-medium mb-1 flex items-center gap-1.5">
                    <Icon
                      name={evalResult.correct ? "check_circle" : "psychology"}
                      className="text-[16px]"
                    />
                    {evalResult.correct ? "Correct" : "Let's fix this misconception"}
                  </div>
                  {evalResult.misconception && (
                    <p className="text-on-surface-variant">Misconception: {evalResult.misconception}</p>
                  )}
                  {stance && <p className="text-on-surface-variant mt-1">{stance.note}</p>}
                </div>
              )}

              {/* Remediation's only way forward. It used to be a small chip
                  inside the feedback box, below the answer input, where it was
                  easy to miss entirely and the lesson looked stuck. */}
              {phase === "remediation" && (
                <button
                  onClick={() => goNext()}
                  className="w-full px-4 py-3 rounded-full bg-primary-container text-on-primary-container text-sm font-medium flex items-center justify-center gap-2 hover:brightness-110"
                >
                  Continue lesson
                  <Icon name="arrow_forward" className="text-[18px]" />
                </button>
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
