# Aetheris AI — A Human-Like AI Educator That Teaches Through Video

**🔗 Live demo: [ai-teacher-mu-seven.vercel.app](https://ai-teacher-mu-seven.vercel.app)**

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

Beyond the mandatory list, the app has accounts (email/password, with optional Google OAuth) backed by Postgres, so learner history and uploaded documents follow the account rather than the browser, and a **Settings** screen (`SettingsDashboard.tsx`) for accent palette, background density, motion intensity and narration voice.

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

- **LLM**: a pluggable provider layer (`src/lib/llm.ts`, `src/lib/providers/`) selected with `LLM_PROVIDER` — `groq` (default) or `gemini`, each hitting the vendor's API directly. Retry, fallback and timeout handling is shared across both, so switching provider is an environment-variable change rather than a code change.
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

The learner's `language` field is passed into every generation prompt, so lesson content is authored directly in the target language rather than translated after the fact (works regardless of the uploaded material's language — e.g. an English textbook taught in Hindi). Mid-lesson, switching the language dropdown calls `translateSection` for the current and all remaining sections, preserving ids/structure/visual type so the lesson state and progress aren't lost. Speech uses a language-to-BCP47 map (`useSpeech.ts`) covering all 22 languages to select a matching browser TTS voice, falling back from an exact locale match to any voice sharing the language prefix. Where the device has no voice at all for a language, the app says so rather than narrating silently — see Voice Implementation.

## Voice Implementation

Uses the browser-native **Web Speech API** (`SpeechSynthesis`) — zero cost, no API key, works offline once the page is loaded. A watchdog timer (`src/hooks/useSpeech.ts`) guarantees the lesson always advances even if a browser/environment never fires TTS lifecycle events (observed in headless/automated testing), so a missing voice can never hang the lesson.

Voices come from the operating system, not the app, so **not every offered language can actually be narrated on every device**. `hasVoiceFor()` resolves the lesson language against the installed voice list, and both places a language is chosen — the setup form and the in-lesson switcher — say so plainly when no voice exists, rather than letting the lesson run silently. On a stock macOS install, 17 of the 22 languages resolve to a voice; Marathi, Gujarati, Malayalam, Punjabi and Urdu do not. Narration is the only thing affected: slides, diagrams, captions, checkpoints and the quiz are unchanged.

## Avatar / Video Generation Approach

Rather than a third-party avatar API, the avatar is an animated inline SVG (`Avatar.tsx`) with idle blinking and a mouth that opens/closes in sync with the TTS speaking state — combined with a synchronized on-screen slide (`SlideRenderer.tsx`) that renders the subject-appropriate visual (KaTeX equations, a custom canvas function plotter, Mermaid diagrams for processes/architecture/flow, syntax-highlighted code, or a timeline component) alongside narration text and a worked example. This is the live "teaching video" experience. A **"Record teaching video"** control (`VideoRecorder.tsx`) additionally captures the browser tab (video + narration audio) via `getDisplayMedia` + `MediaRecorder` into a real downloadable `.webm` file on demand — a genuine video artifact, entirely client-side and free, satisfying the literal "video-based AI Teacher presentation" requirement without a paid avatar service.

## APIs and Third-Party Services

- **Google Gemini** or **Groq** — LLM inference, selected with `LLM_PROVIDER` (defaults to `groq`). Requires `GEMINI_API_KEY` or `GROQ_API_KEY` accordingly; `GEMINI_MODEL` / `GROQ_MODEL` override the default model.
- **Postgres** (Neon on the hosted demo) — accounts, sessions, learner history, and uploaded-document chunks with their embeddings.
- **Google OAuth** — optional. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to enable "Continue with Google"; leave them unset and the provider isn't registered, so the button is hidden rather than shown and broken. Email/password sign-in works either way.
- **Everything else runs locally**: local embeddings (no API), browser Web Speech API (no API), browser `getDisplayMedia`/`MediaRecorder` (no API), Mermaid/KaTeX/Prism (client-side rendering libraries, no network calls).

## Setup Instructions

```bash
cd ai-teacher
npm install
cp .env.local.example .env.local
# edit .env.local: set GROQ_API_KEY (or GEMINI_API_KEY with LLM_PROVIDER=gemini),
# plus DATABASE_URL and AUTH_SECRET (openssl rand -base64 32)
npm run migrate    # applies db/migrations/ (accounts, history, documents, quizzes)
npm run dev
# open http://localhost:3000
```

Requires Node 22.6 or newer (the test runner executes the project's TypeScript
directly through Node's type stripping). Run the checks with:

```bash
npm run check      # lint + typecheck + tests
npm test           # 415 tests, no framework — Node's own runner
npm run migrate -- --status   # what the database has, and what is pending
npm run retention             # uploads past their retention window (dry run)
```

Operational runbooks — health, alerts, incident playbooks, backups, retention
— are in [docs/OPERATIONS.md](docs/OPERATIONS.md). The audit remediation is
tracked finding by finding in
[docs/REMEDIATION-LEDGER.md](docs/REMEDIATION-LEDGER.md).

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are optional — without them the app runs on email/password sign-in and hides the Google button.

First document upload triggers a one-time download of the local embedding model (~90MB, cached afterward).

## Deployment Instructions

The [live demo](https://ai-teacher-mu-seven.vercel.app) is deployed on Vercel directly from this repo. To deploy your own copy:

```bash
npm install -g vercel
vercel link
vercel env add GROQ_API_KEY production      # or GEMINI_API_KEY, with LLM_PROVIDER=gemini
vercel env add DATABASE_URL production      # Postgres connection string
vercel env add AUTH_SECRET production       # openssl rand -base64 32
vercel --prod
```

It also deploys like any standard Next.js app to any Node host:

```bash
npm run build
npm start
```

Set `GROQ_API_KEY` (or `GEMINI_API_KEY` with `LLM_PROVIDER=gemini`), `DATABASE_URL` and `AUTH_SECRET` as environment variables on the host, and run `npm run migrate` against that database on every deploy that adds a migration (`npm run migrate -- --status` shows what is applied and what is pending). Migrations live in `db/migrations/` as immutable numbered files, each applied once inside its own transaction and recorded in `schema_migrations`; the baseline is idempotent, so an existing database simply records it and moves on. Uploaded documents and their chunk embeddings are stored in Postgres (`documents` / `document_chunks`), so uploads survive across serverless instances and deployments.

## Security Model

The trust boundary is that **everything the model produces, and everything an
uploaded document contains, is untrusted input** — right through to the point
where it is rendered.

| Control | Where | What it stops |
| --- | --- | --- |
| Allow-listed maths expression parser | `src/lib/security/mathExpression.ts` | Graph expressions are parsed into a small AST and evaluated by walking it. There is no `eval`, no `new Function`, no property access and no way to name anything outside the supported function list. |
| Diagram source check + SVG sanitiser | `src/lib/security/diagram.ts` | Mermaid runs in `securityLevel: "strict"` with HTML labels off; the definition is screened for markup, `click` directives and script-capable URLs, and the rendered SVG is sanitised against an allow-list before it reaches the DOM. |
| Callback destination validator | `src/lib/security/callbackUrl.ts` | `?callbackUrl=` after sign-in accepts only approved internal paths. Absolute, protocol-relative, backslash, encoded and credential-bearing forms all fall back to `/app`. |
| Content Security Policy | `src/lib/security/headers.ts`, applied in `src/proxy.ts` | Per-request nonce with `strict-dynamic`; no `unsafe-inline` and no `unsafe-eval` for scripts outside development. Framing, plugins and cross-origin form posts are refused. |
| Runtime schemas | `src/lib/schemas/` | Every request body and every structured model response is validated and bounded at runtime, not just typed at compile time. Invalid model output gets one bounded repair round and is then rejected rather than persisted. |
| Route guards | `src/lib/apiGuard.ts`, `src/lib/security/http.ts` | Each handler authenticates for itself, derives the user id from the session (never from the body), checks ownership for document ids, and enforces body-size, rate and daily model-cost limits. |
| Upload admission control | `src/lib/security/uploads.ts` | Size cap, magic-number check against the claimed extension, and archive entry-count / expanded-size / compression-ratio limits read from the zip directory before anything is decompressed. |
| Verified database TLS | `db/ssl.mjs` | Remote Postgres connections verify the server certificate. The insecure escape hatch is refused when `NODE_ENV=production`. |
| Server-owned grading | `src/lib/grading.ts`, `src/app/api/lesson/quiz/*` | The assessment's answer key never leaves the server. The browser receives questions with stable option ids and no key, submits option ids, and receives marks decided server-side; the report's score comes from the stored attempt, not from the model or the client. |
| Server-owned lessons | `src/lib/lessonState.ts`, `src/lib/lessonSessionStore.ts` | The lesson plan — checkpoint answers included — lives in `lesson_sessions`. The browser gets a projection without the keys. Every command carries the session version it expected, checked both in the state machine and in the `UPDATE` predicate, so a stale tab or a delayed retry cannot move the lesson on. Completion is one transaction. |

Two consequences worth knowing about:

- **Every page is server-rendered per request** (`export const dynamic` in
  `src/app/layout.tsx`). A nonce-based CSP cannot be applied to a page
  prerendered at build time, so static optimisation was traded for a script
  policy with no `unsafe-inline`.
- **Rate limits are per instance.** The counters live in process memory, so a
  deployment running N instances has an effective limit of up to N times the
  configured value. That is a deliberate, documented simplification; moving to
  a shared store means changing one function (`consume` in
  `src/lib/security/rateLimit.ts`).

**Uploaded material** can be deleted from the setup screen, which removes the
document, its chunks and its embeddings. `npm run retention` reports uploads
older than `DOCUMENT_RETENTION_DAYS` (90 by default) and deletes them with
`--apply`; point a scheduler at it rather than expecting the app to run it.
Deleting an account removes its documents, history and quizzes by cascade.

Security controls are covered by regression tests — `npm test` runs the
open-redirect, expression-injection, diagram-injection, zip-bomb,
authorization-matrix and cross-tenant cases.

## Known Limitations

- **Free-tier LLM latency/flakiness**: the default provider (`LLM_PROVIDER=groq`) runs on a free, shared pool and can be slow or occasionally time out under load, despite the app's retry/fallback/timeout handling. Switching to `gemini`, or pointing `GROQ_MODEL`/`GEMINI_MODEL` at a paid tier, removes this.
- **TTS voice availability**: narration voices come from the browser/OS, not the app. On a stock macOS install, 5 of the 22 offered languages (Marathi, Gujarati, Malayalam, Punjabi, Urdu) have no installed voice. The app detects this and says so up front instead of running a silent lesson, but it cannot supply the voice — that needs a server-side TTS service.
- **Video export** uses tab capture (`getDisplayMedia`), which requires the user to grant screen-share permission each time and to enable "share tab audio" — it does not run headless/automatically.
- **PPTX/PDF parsing is text-only**: embedded images/diagrams in source material are not extracted or shown; only text content is used for grounding.
- **Interface preferences are per-device**: accent, background density, motion and narration voice are stored in `localStorage` rather than on the account, so they don't follow a learner to another browser or machine.
- **Partial test coverage**: security-critical logic (validators, schemas, parsers, route authorization) has automated regression tests. Component, browser and load tests are not written yet, so UI behaviour is still verified manually.
- **Ingestion has no worker**: indexing is a durable, checkpointed job, but its slices are driven by the browser polling while it waits rather than by a queue consumer. Closing the tab pauses indexing rather than losing it; re-uploading resumes from the checkpoint.
- **English-oriented embeddings**: the default embedding model is English-oriented while the product teaches in 22 languages. The full-text half of retrieval is language-neutral, and every vector records the model that produced it, so switching is a supported data migration rather than a silent corruption — but it has not been switched.
- **Vector search runs in Node**: similarity is computed over one document's chunks in the application rather than in Postgres. `db/optional/0001_pgvector.sql` is the upgrade and needs a decision about the database extension.
- **No password reset or email verification**: both need an email provider. Data export and account deletion do exist.
