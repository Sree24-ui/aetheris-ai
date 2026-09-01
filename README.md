# Aetheris AI — A Human-Like AI Educator That Teaches Through Video

Built for the AI Innovation Hackathon 2026 — Round 2 Technical Assessment ("AI Teacher" challenge).

The UI follows a dark, glassmorphic Material Design 3–inspired system (design tokens in [`src/app/globals.css`](src/app/globals.css), fonts Inter/Montserrat + Material Symbols in [`src/app/layout.tsx`](src/app/layout.tsx)): a sidebar/top-nav app shell ([`AppShell.tsx`](src/components/AppShell.tsx)), a dashboard home ([`HomeDashboard.tsx`](src/components/HomeDashboard.tsx)), a bubble-style lesson configuration screen ([`ConfigForm.tsx`](src/components/ConfigForm.tsx)), a "Classroom" teaching view with a video-frame avatar and an interactive chat transcript ([`TeachingSession.tsx`](src/components/TeachingSession.tsx)), and a "Lesson Complete" report with an animated score ring ([`ReportPanel.tsx`](src/components/ReportPanel.tsx)).

## Problem Statement

Traditional digital learning platforms provide pre-recorded lectures or text-based Q&A chatbots. Neither adapts to an individual learner in real time. This project builds an AI-powered virtual teacher that ingests a topic or an uploaded document, plans a personalized lesson, teaches it through a video-style presentation with a speaking avatar, questions the student along the way, detects misconceptions, adapts its explanations, and reports on what was learned.

## Solution Overview

The app is a single Next.js full-stack application. A student either uploads course material (PDF/DOCX/PPTX/TXT) or names a topic directly, sets their level/language/available time, and the system:

1. **Understands** — retrieves the most relevant passages from the uploaded material (RAG) or draws on general subject knowledge for a bare topic.
2. **Plans** — an LLM call produces a structured, multi-section lesson plan tailored to the learner's level, time budget, and language, choosing a subject-appropriate visual for each section (equation, graph, Mermaid diagram, code, timeline, or markdown).
3. **Explains / Demonstrates** — each section is presented as an "AI teaching video": an animated avatar speaks the narration (via browser TTS) while the on-screen slide renders bullet points, the chosen visual, and a worked example.
4. **Questions / Evaluates** — sections carry checkpoint questions; the student's answer is graded by the LLM, which also detects the specific misconception behind a wrong answer.
5. **Adapts** — on an incorrect/partial answer, the AI re-explains the concept with a new analogy and a fresh example before continuing (`Understand → Plan → Explain → Demonstrate → Question → Evaluate → Adapt → Continue`).
6. **Assesses** — after the lesson, a mixed MCQ/short-answer quiz is generated and graded, producing a learning report (score, strong/weak areas, recommendation, suggested next topic).
7. **Tracks** — a per-browser learner profile (localStorage) accumulates history, strong/weak concepts across sessions, shown on the "Progress" dashboard and surfaced back to the student on return visits. Every completed lesson is saved as a full history entry — topic, score, and the **entire lesson conversation transcript** (every narration, question, answer, and feedback message) plus the quiz Q&A — expandable inline from the History list, so a student (or a grader) can revisit exactly what was taught and discussed in any past session, not just the score.
8. **Generates learning paths** — for broad topics, the system produces a multi-step curriculum the student can walk through one lesson at a time.

## Key Features (mapped to the mandatory requirements)

| # | Requirement | Where it lives |
|---|---|---|
| 1 | Learning from uploaded material | `src/lib/documentParser.ts`, `src/lib/vectorStore.ts`, `/api/upload` |
| 2 | Topic-based teaching | `/api/lesson/plan` with no `docId` |
| 3 | AI-generated lesson structure | `planLesson()` in `src/lib/teachingAgent.ts` |
| 4 | Personalized teaching | Learner profile (level/language/time/objective/style) threaded through every prompt |
| 5 | Human-like teaching interaction | `TeachingSession.tsx` state machine (narrate → checkpoint → evaluate → remediate → continue) |
| 6 | Video-based AI Teacher presentation | Animated `Avatar.tsx` + synced `SlideRenderer.tsx`, TTS narration, optional real `.webm` export via `VideoRecorder.tsx` |
| 7 | AI voice | Browser Web Speech API (`useSpeech.ts`), language-matched voice selection |
| 8 | Human-like AI avatar | `Avatar.tsx` — animated SVG face with blinking + speech-synced mouth movement |
| 9 | Multilingual capability | `language` on the learner profile drives generation language; live language switch mid-lesson via `translateSection()` |
| 10 | Student questioning & assessment | Checkpoint questions during the lesson + end-of-lesson quiz (`QuizPanel.tsx`) |
| 11 | Adaptive response to performance | `evaluateAnswer()` misconception detection + remediation flow |
| 12 | Working application/prototype | This app — see Setup below |

## System Architecture

```
Browser (React client)
  ├─ SetupForm            → collects topic/upload + learner profile, or parses free-text instructions
  ├─ TeachingSession       → drives the lesson section-by-section, avatar + TTS + visuals + checkpoints
  ├─ QuizPanel / ReportPanel → end-of-lesson assessment and feedback
  ├─ LearningPathPanel     → multi-step curriculum navigation
  └─ LearnerDashboard      → localStorage-backed learning history/profile

Next.js Route Handlers (server, Node runtime)
  ├─ /api/upload                 → parse document → chunk → embed → persist vectors
  ├─ /api/lesson/plan             → RAG retrieval (if docId) + planLesson()
  ├─ /api/lesson/evaluate         → answer grading + misconception detection
  ├─ /api/lesson/quiz             → end-of-lesson question generation
  ├─ /api/lesson/report           → score + strengths/weaknesses + recommendation
  ├─ /api/lesson/translate-section→ mid-lesson language switch, preserving lesson state
  ├─ /api/learning-path           → multi-step curriculum generation
  └─ /api/instruction             → free-text instruction → structured profile fields

Local RAG store (.data/documents/*.json, filesystem — no external DB)
  chunk text → local embedding vectors → cosine-similarity top-k retrieval
```

No lesson state lives on the server between requests except the ingested document vectors; the lesson plan and session state live entirely in the browser (plus localStorage for cross-session learner memory), which keeps the app trivially deployable and avoids needing a database.

## AI/ML Models Used

- **LLM**: routed through [OpenRouter](https://openrouter.ai) (`OPENROUTER_API_KEY`), defaulting to a free-tier model chain (`OPENROUTER_MODEL`, with `OPENROUTER_FALLBACK_MODELS` tried in order on error/timeout/rate-limit). This is provider-agnostic — pointing `OPENROUTER_MODEL` at `anthropic/claude-sonnet-4.5` or `openai/gpt-4.1` (or swapping the client in `src/lib/llm.ts` for a direct Anthropic/OpenAI SDK) is a one-line change and will materially improve reliability and lesson quality over the free tier.
- **Embeddings**: local, in-process — `Xenova/all-MiniLM-L6-v2` via `@xenova/transformers` (ONNX runtime, runs on CPU, no external API call, no cost).

## RAG Implementation

`src/lib/documentParser.ts` extracts plain text from PDF (`pdf-parse`), DOCX (`mammoth`), or PPTX (manual OOXML slide-XML parsing via `jszip` + `xml2js`). `src/lib/chunk.ts` splits the text into ~900-character paragraph-aware chunks with overlap. `src/lib/embeddings.ts` embeds each chunk locally. `src/lib/vectorStore.ts` persists chunk text + vectors to a JSON file per document and performs cosine-similarity top-k retrieval at lesson-planning time. The retrieved excerpts are injected into the lesson-planning prompt with an explicit instruction to ground the lesson in them and avoid fabricating unsupported specifics — verified in testing to pull real, specific facts (course codes, cited reports, program names) straight from the uploaded material rather than hallucinating.

## Prompt / Agent Architecture

A single lightweight "teaching agent" module (`src/lib/teachingAgent.ts`) holds one function per pedagogical responsibility, each a focused prompt against the shared LLM client:

- `parseInstruction` — free-text → structured learner profile fields
- `planLesson` — the core planner; encodes the Understand→Plan→Explain→Demonstrate→Question→Evaluate→Adapt→Continue pedagogy and the subject-aware visual-selection rules directly in the system prompt
- `evaluateAnswer` — correctness + misconception + remediation (re-explanation, new analogy, new example)
- `generateQuiz` / `generateReport` — end-of-lesson assessment and reporting
- `translateSection` — re-expresses one lesson section in a new language while preserving structure/ids
- `generateLearningPath` — multi-step curriculum for a broad topic

All calls request strict JSON and are parsed with a fenced-code-block-tolerant extractor (`src/lib/llm.ts`); there is no multi-agent orchestration framework — each call is a single, narrowly-scoped LLM request, which keeps latency and failure modes predictable on a free-tier model.

## Personalization Approach

Every prompt is built with the learner's level, preferred language, available time, objective, and style. Time budget directly controls lesson depth (the planner is instructed to produce 2–3 sections for 5 minutes up to 7–10 for 60 minutes). Returning students see their accumulated weak/strong concepts on the setup screen and dashboard (from `localStorage`, via `src/lib/memory.ts`), and the "Suggested next topic" from each report can be started as the next lesson with one click.

## Assessment Methodology

Two layers of assessment: (1) in-lesson **checkpoint questions** embedded in the lesson plan, answered inline and graded immediately with misconception-aware feedback; (2) an **end-of-lesson quiz** (mixed MCQ/short-answer) generated from the concepts actually taught, graded (MCQ by exact match, short-answer via the same LLM evaluator used for checkpoints), and rolled up into a learning report (score %, strong/weak areas, incorrect concepts, recommendation, suggested next topic) — persisted to the learner's local history.

## Multilingual Implementation

The learner's `language` field is passed into every generation prompt, so lesson content is authored directly in the target language rather than translated after the fact (works regardless of the uploaded material's language — e.g. an English textbook taught in Hindi). Mid-lesson, switching the language dropdown calls `translateSection` for the current and all remaining sections, preserving ids/structure/visual type so the lesson state and progress aren't lost. Speech uses a language-to-BCP47 map (`useSpeech.ts`) covering English, Hindi, Hinglish, and 18+ other languages to select a matching browser TTS voice.

## Voice Implementation

Uses the browser-native **Web Speech API** (`SpeechSynthesis`) — zero cost, no API key, works offline once the page is loaded. A watchdog timer (`src/hooks/useSpeech.ts`) guarantees the lesson always advances even if a browser/environment never fires TTS lifecycle events (observed in headless/automated testing), so a missing voice can never hang the lesson.

## Avatar / Video Generation Approach

Rather than a third-party avatar API, the avatar is an animated inline SVG (`Avatar.tsx`) with idle blinking and a mouth that opens/closes in sync with the TTS speaking state — combined with a synchronized on-screen slide (`SlideRenderer.tsx`) that renders the subject-appropriate visual (KaTeX equations, a custom canvas function plotter, Mermaid diagrams for processes/architecture/flow, syntax-highlighted code, or a timeline component) alongside narration text and a worked example. This is the live "teaching video" experience. A **"Record teaching video"** control (`VideoRecorder.tsx`) additionally captures the browser tab (video + narration audio) via `getDisplayMedia` + `MediaRecorder` into a real downloadable `.webm` file on demand — a genuine video artifact, entirely client-side and free, satisfying the literal "video-based AI Teacher presentation" requirement without a paid avatar service.

## APIs and Third-Party Services

- **OpenRouter** (`openrouter.ai`) — LLM inference gateway. Requires `OPENROUTER_API_KEY`.
- **Everything else runs locally**: local embeddings (no API), browser Web Speech API (no API), browser `getDisplayMedia`/`MediaRecorder` (no API), Mermaid/KaTeX/Prism (client-side rendering libraries, no network calls).

## Setup Instructions

```bash
cd ai-teacher
npm install
cp .env.local.example .env.local
# edit .env.local and set OPENROUTER_API_KEY=sk-or-v1-...
npm run dev
# open http://localhost:3000
```

First document upload triggers a one-time download of the local embedding model (~90MB, cached afterward).

## Deployment Instructions

Deploys like any standard Next.js app (Vercel, or any Node host):

```bash
npm run build
npm start
```

Set `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL` / `OPENROUTER_FALLBACK_MODELS`) as environment variables on the host. The `.data/documents` directory is filesystem-based storage for uploaded document vectors — on a serverless/ephemeral-filesystem host (e.g. Vercel serverless functions), uploaded documents will not persist between deployments/cold starts; for a persistent production deployment, swap `src/lib/vectorStore.ts`'s filesystem calls for a real database or object store.

## Known Limitations

- **Free-tier LLM latency/flakiness**: the default `OPENROUTER_MODEL` (`minimax/minimax-m3:free`) and its fallbacks are free, shared-pool models on OpenRouter and can be slow (10–60s) or occasionally time out entirely under load, despite the app's retry/fallback/timeout handling. Pointing `OPENROUTER_MODEL` at a paid model (e.g. `anthropic/claude-sonnet-4.5`) removes this limitation.
- **TTS voice availability/quality** depends on the browser/OS's installed voices; some environments have no voices for a given language, in which case the avatar's mouth won't move but the lesson still advances (via the watchdog) and on-screen text/visuals are still shown.
- **Video export** uses tab capture (`getDisplayMedia`), which requires the user to grant screen-share permission each time and to enable "share tab audio" — it does not run headless/automatically.
- **No server-side lesson persistence**: lesson/session state lives in the browser; refreshing mid-lesson restarts the current lesson (learner history/progress in `localStorage` is unaffected).
- **PPTX/PDF parsing is text-only**: embedded images/diagrams in source material are not extracted or shown; only text content is used for grounding.
- **Single learner profile per browser**: there is no login/multi-user support — `localStorage` history is per-browser, not per-account.
