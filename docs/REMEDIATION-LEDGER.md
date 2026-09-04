# Remediation ledger — Aetheris AI audit (4 September 2026)

Tracks every finding in `Aetheris_AI_Project_Audit_Report.md` against the code
as it stands. A finding is only marked **Fixed** when its acceptance test
passes; "the code looks right" is not a status.

**Progress: Phase 0 complete; Phase 1 in progress.** Phase 0 (security
containment) is closed. Phase 1 (reliable learning workflow) has started with
the persistence and progress findings — H7, H8, M1 and M2. Everything still
open carries its current status and the exact next step.

## Verification commands

```bash
npm run lint       # eslint            -> clean
npx tsc --noEmit   # TypeScript strict -> clean
npm test           # 298 tests         -> 298 pass, 0 fail
npm run build      # production build  -> compiled, 21 routes
npm run check      # all three of the above in sequence
```

Baseline before any change: lint clean, typecheck clean, build passing, **zero
tests** (there was no test runner). No pre-existing failures were found, so
none are being hidden.

## Status summary

| Status | Count | IDs |
| --- | --- | --- |
| Fixed, with regression tests | 14 | C1, C2, H1, H2, H4, H5, H6, H7, M1, M2, M7, M8, M9, M15 |
| Partially fixed | 6 | H3, H8, H10, H12, M12, M16 |
| Confirmed, still open — Phase 1 | 3 | H9, M10, M11 |
| Confirmed, still open — Phase 2 | 5 | H11, M3, M4, M5, M6 |
| Confirmed, still open — Phase 3/4 | 2 | M13, L2 |
| Already accurate / closed | 2 | M14, L1 |

All 32 findings (C1–C2, H1–H12, M1–M16, L1–L2) are accounted for above.

No confirmed **critical or high security** finding remains open. The highs
still outstanding — H9, H11, and the checkpoint half of H10 — are reliability
and data-integrity findings, which the report itself places in Phases 1 and 2.

---

## Critical

### C1 — Model-generated graph expressions execute as JavaScript

- **Status:** Fixed
- **Confirmed at:** `src/components/GraphCanvas.tsx:32`,
  `new Function("x", '"use strict"; return (' + expression + ')')`. The
  expression comes from `LessonPlan.sections[].visual.graph.expression`, i.e.
  straight from the model, and the teaching prompt explicitly asked for
  "a JS-evaluable function of x".
- **Implementation:**
  - New `src/lib/security/mathExpression.ts` — tokeniser, recursive-descent
    parser and AST evaluator for a closed language: numbers, `x`, `pi`/`e`/
    `tau`, `+ - * / % ^`, parentheses, and 27 named maths functions. No
    identifier outside that list parses; there is no property access, no
    assignment, no statement, no call to anything that is not in the table.
  - Bounds: 256-character source, 200 tokens, depth 24, 200 AST nodes, and
    results forced to `NaN` when non-finite or beyond ±1e12.
  - `Math.sin(x)` is accepted as a compatibility spelling and normalised at
    the token level — it is not general property access, and `Math.evil(x)`
    or `window.location` still fail to parse.
  - `GraphCanvas` renders a failure state instead of a curve when compilation
    fails, and clamps the model-supplied domain.
  - The teaching prompt (`VISUAL_GUIDE` in `src/lib/teachingAgent.ts`) now
    documents the real grammar so the model stops emitting JavaScript.
  - CSP has no `unsafe-eval` outside development, so the sink is closed at the
    browser level too.
- **Tests:** `src/lib/security/mathExpression.test.ts` — 69 cases. 34
  adversarial (`window.location`, `document.cookie`, `x.constructor.
  constructor('return 1')()`, `fetch(...+document.cookie)`, `eval`, `import`,
  assignment, comma operator, arrow functions, template literals, bracket
  access, comments, over-long/over-nested/over-tokenised input), 27 valid
  expressions that must still render, plus the numeric-safety cases.
- **Residual risk:** A syntactically valid expression can still draw a
  misleading graph. That is a content-quality problem, not a code-execution
  one.

### C2 — Sign-in redirects trust an unsanitised callback URL

- **Status:** Fixed
- **Confirmed at:** `src/app/signin/page.tsx:14` (`searchParams.get("callbackUrl")`)
  reaching `router.push(callbackUrl)` at line 55 and
  `signIn("google", { callbackUrl })` at line 145.
- **Implementation:** `src/lib/security/callbackUrl.ts` — one validator used
  by the sign-in page and by `proxy.ts` when it builds the sign-in redirect.
  A candidate must be a string under 512 characters, free of control
  characters and backslashes, start with a single `/`, survive percent-decoding
  without revealing `//` or `\`, resolve to a sentinel origin, carry no
  credentials, and fall inside `ALLOWED_CALLBACK_ROOTS` (`/app`). The returned
  value is rebuilt from the parsed URL rather than echoed. `safeCallbackUrl`
  takes the origin from the caller, never from the input.
- **Tests:** `src/lib/security/callbackUrl.test.ts` — 37 cases covering
  absolute URLs of every scheme, `//host`, `\\host`, `/\host`, `java\nscript:`,
  `data:`, `%2f%2f`, `%5c%5c`, embedded credentials, malformed encodings,
  non-strings, over-long values, internal paths outside the allow-list, and
  the valid paths that must still work.
- **Residual risk:** None known. Adding a new top-level route that should be a
  valid post-sign-in destination requires adding it to
  `ALLOWED_CALLBACK_ROOTS` — deliberately explicit.

---

## High

### H1 — Generated Mermaid SVG injected in loose security mode

- **Status:** Fixed
- **Confirmed at:** `src/components/MermaidDiagram.tsx:17` (`securityLevel: "loose"`)
  and `:46` (`dangerouslySetInnerHTML`).
- **Implementation:** `src/lib/security/diagram.ts` provides three layers.
  (1) `checkMermaidDefinition` screens the source for raw markup tags, `click`
  and `link` interaction directives, `javascript:`/`vbscript:`/`data:` URLs,
  event-handler attributes, `%%{init}%%` config directives, HTML entities,
  `expression(`, `url(` and `@import`; it is written to avoid false positives
  on legitimate diagrams (`A[if x<y]`, a node labelled "JavaScript: a
  language"). (2) `MERMAID_CONFIG` pins `securityLevel: "strict"`,
  `htmlLabels: false` and bounds `maxTextSize`/`maxEdges`. (3)
  `sanitizeDiagramSvg` runs the rendered SVG through DOMPurify's SVG profile
  with an explicit deny list for `script`, `foreignObject`, `a`, `use`,
  `image`, the animation elements, and every link/target attribute.
  A rejected diagram renders an explanatory note, not a broken frame.
- **Tests:** `src/lib/security/diagram.test.ts` — 36 cases: 22 malicious
  definitions, 10 legitimate diagrams that must keep rendering, and assertions
  that the sandbox settings and deny lists have not been loosened.
- **Residual risk:** The DOMPurify pass is browser-only and is covered by
  DOMPurify's own suite rather than by a test here; a browser-level test of the
  rendered DOM is Phase 4 work. `htmlLabels: false` renders labels as SVG
  `<text>`, which is a small visual change from the previous output.

### H2 — API inputs and model outputs lack runtime schemas

- **Status:** Fixed for requests and model responses; database JSON deferred
- **Confirmed at:** every route did `const body = await req.json()` followed by
  a cast; `src/lib/llm.ts:171-199` did `JSON.parse(raw) as T`.
- **Implementation:**
  - `src/lib/schemas/model.ts` — schemas for lesson plan, section, visual,
    graph, timeline, checkpoint, quiz, evaluation, report, learning path,
    concepts, chat answer and parsed instruction. Every string and array is
    bounded, so one response cannot create unbounded downstream work.
  - `src/lib/schemas/requests.ts` — schemas for all 15 request bodies.
  - `callModelSchema` in `src/lib/llm.ts` replaces `callModelJSON`: it parses,
    validates, and on failure runs up to `LLM_MAX_REPAIR_ATTEMPTS` (default 1)
    repair rounds that show the model its own output *as data* plus the
    specific validation errors. Repair shares the caller's end-to-end
    deadline. After that the call fails cleanly instead of persisting a
    half-valid lesson.
  - `readValidatedBody` in `src/lib/security/http.ts` enforces a byte limit
    before and after reading, then validates. Rejections name the failing
    field paths and never echo the submitted values.
- **Tests:** `src/lib/schemas/requests.test.ts` (13 cases) and
  `src/lib/security/http.test.ts` (10 cases).
- **Residual risk:** JSONB read back from `learner_history_entries` and
  `learner_learning_path` is still trusted in `src/lib/serverMemory.ts`. It can
  only contain what a validated write put there, so the exposure is low, but
  validating on read is a Phase 1 item.

### H3 — Uploaded document text treated as trusted instruction context

- **Status:** Partially fixed
- **Confirmed at:** `src/lib/teachingAgent.ts:153` — retrieved excerpts were
  interpolated as "Source material context (grounded, use this as the primary
  source of truth)".
- **Implementation:** Retrieved text is now wrapped by `untrustedSourceBlock`
  in explicit `BEGIN_SOURCE_MATERIAL`/`END_SOURCE_MATERIAL` markers (with the
  marker string stripped from the content so a document cannot close the block
  early), and `SOURCE_MATERIAL_RULES` tells the model that everything inside is
  data, that instructions found there must never be followed, and that it must
  not change the rules, output shape, language or visual types.
- **What actually contains the risk:** prompt isolation is a mitigation, not a
  guarantee. The controls that make an injected payload inert are C1 (the
  expression parser), H1 (the diagram gates) and H2 (output schemas) — all
  closed.
- **Deferred:** a prompt-injection evaluation set (report §6, Phase 2) and
  citation provenance.

### H4 — Sensitive routes rely on proxy-level access control

- **Status:** Fixed
- **Confirmed at:** `src/proxy.ts` gated `/api/*`; seven AI routes
  (`instruction`, `learning-path`, `lesson/chat|evaluate|quiz|report|
  translate-section`) never resolved a session themselves.
- **Implementation:** `src/lib/apiGuard.ts` `defineRoute` wraps every handler
  with `requireUserId()`, which reads the id from the verified session only —
  no route reads an identity from a body, query string or header. Ownership is
  checked where a resource id is supplied: `lesson/plan` calls
  `documentExists(docId, userId)` and answers 404 for another learner's
  document. The proxy is kept as an outer perimeter and now also carries the
  security headers.
- **Tests:** `src/app/api/routes.test.ts` — the authorization matrix. 37 cases. 30
  assert 401 for every sensitive method/route with no session *and* with a
  session carrying no user id, with the proxy out of the picture; the rest
  cover
  cross-tenant document access (404 for a stranger, 200 for the owner),
  unknown document ids, invalid bodies (400), rate limiting (429 with
  `Retry-After`), and that registration stays reachable while signed out.
- **Residual risk:** None known for the routes that exist. A new route that
  does not use `defineRoute` would not be covered — the matrix test is the
  place to add it.

### H5 — No rate limits or request/upload size limits

- **Status:** Fixed (in-process)
- **Implementation:**
  - `src/lib/security/rateLimit.ts` — fixed-window counters with pruning and a
    bounded key map. Budgets: 60/min for database routes, 20/min for
    model routes, 300/day shared across *all* model routes per user, 10/hour
    for uploads, 5/hour per client address for registration.
  - `readValidatedBody` rejects on `Content-Length` and again on the real
    decoded length (413), per-route: 4–16 KB for small bodies, 256 KB for
    chat/translate, 1 MB for the routes that carry a whole lesson plan.
  - `src/lib/security/uploads.ts` — 8 MB file cap (held below Next's 10 MB
    proxy body buffer, which *truncates* rather than rejects), magic-number
    check against the claimed extension, and zip limits read from the central
    directory *without decompressing*: 2000 entries, 60 MB total expansion,
    compression ratio 120. Extracted text is capped at 2,000,000 characters.
  - Token budgets are integer- and ceiling-checked (`MAX_OUTPUT_TOKENS`), and
    every model operation runs under `TOTAL_DEADLINE_MS`.
- **Tests:** `src/lib/security/rateLimit.test.ts` (6), `uploads.test.ts` (16,
  including a zip bomb rejected on ratio and one rejected on absolute
  expansion), `http.test.ts` (10, including a lying `Content-Length`).
- **Residual risk:** Counters are per process. Across N instances the
  effective limit is up to N× the configured value. Documented in the README;
  `consume()` is the single function to change for a shared store. There is
  still no concurrency cap on embedding work (Phase 2, with H11).

### H6 — Database TLS certificate verification disabled

- **Status:** Fixed
- **Confirmed at:** `src/lib/db.ts:15` and `db/migrate.mjs:30`, both
  `rejectUnauthorized: false`.
- **Implementation:** `db/ssl.mjs` (shared by the pool and the migration
  runner). Local hosts get no TLS; every other host gets
  `rejectUnauthorized: true`, optionally with `DATABASE_CA_CERT`.
  `DATABASE_SSL_INSECURE=true` is honoured only outside production and
  **throws** when `NODE_ENV=production`. The old check was
  `connectionString.includes("localhost")`, which a host named
  `localhost.evil.example` satisfied; host matching is now exact.
  Pool bounds (`max`, idle/connect/statement timeouts) were added at the same
  time.
- **Tests:** `db/ssl.test.mjs` — 8 cases including the `localhost.evil.example`
  bypass and the production refusal.
- **Manual step required:** confirm your provider's certificate chains to a
  public CA (Neon, Supabase and RDS with the public bundle do). If it uses a
  private CA, set `DATABASE_CA_CERT`. **This was not tested against your live
  database in this session** — run `npm run migrate` once against staging
  before deploying.

### H7 — History and path mutations can fail silently

- **Status:** Fixed
- **Confirmed at:** `src/lib/memory.ts:26-44` — `addHistoryEntry`,
  `setCurrentPath` and `advancePath` each did `await fetch(...)` and discarded
  the result, so a 401 from an expired session, a 429, a 500 and a dropped
  connection were all indistinguishable from a successful save. `loadMemory`
  was worse: it caught every failure and returned an empty memory, so a signed
  -out learner saw "no lessons completed yet" rather than "sign in again".
- **Implementation:**
  - New `src/lib/http.ts` — `apiRequest` returns a parsed body or throws
    `RequestFailed`, which carries a sentence fit to show, whether a retry is
    worth offering, the `Retry-After` hint, and the server's request id. An
    `AbortError` is re-thrown untouched so a cancelled request is not reported
    as a failure.
  - `src/lib/memory.ts` rewritten on top of it; every function now throws.
  - Callers handle it: `HomeDashboard` shows a notice that its figures may be
    stale, `LearnerDashboard` shows the failure with a retry button instead of
    an empty history, `ProfileDashboard` no longer sits on its loading state
    forever, and `src/app/app/page.tsx` reports session expiry specifically.
  - Idempotency: the history entry id is minted once per completed lesson and
    reused across retries (`pendingHistoryId`), and the server treats a second
    write of the same id as a replay (`ON CONFLICT (id) DO NOTHING`) rather
    than a duplicate-key 500. A second learner sending someone else's id gets
    a 409.
- **Tests:** `src/lib/http.test.ts` — 14 cases: every failing status becomes a
  described throw, network failure, non-JSON error body, `Retry-After`
  parsing, retryable classification, abort passthrough, empty 200 body,
  session-expiry detection. `src/app/api/routes.test.ts` adds the replay and
  409 cases.
- **Residual risk:** The `ON CONFLICT` SQL itself is not covered — that needs
  a database. The route tests prove the contract the routes depend on.

### H8 — Learning path state is incomplete and can advance incorrectly

- **Status:** Partially fixed — three of the four sub-problems are closed
- **Fixed: the off-by-one.** `advancePathForUser` clamped with
  `jsonb_array_length(path->'steps')`, one *past* the last valid index, so
  finishing the final step left the path pointing at a step that does not
  exist. Now `GREATEST(jsonb_array_length(...) - 1, 0)`.
- **Fixed: unconditional advancement.** The command now carries
  `fromStepIndex` — the step the finished lesson belonged to — and the
  `UPDATE` only matches while the stored index still equals it. A duplicate,
  delayed or out-of-order completion is a no-op that reports the current
  position (`advanced: false`) instead of skipping a step.
- **Fixed: lesson/path association.** `src/app/app/page.tsx` tracks
  `activePathStep`, set only when a lesson is started from a path step.
  Completing a standalone lesson no longer advances a path the learner was
  not working through.
- **Fixed: index clamping on write.** `POST /api/history/path` clamps
  `stepIndex` to a real step of the submitted path.
- **Tests:** `src/app/api/routes.test.ts` — duplicate completion advances
  exactly once, the index never runs past the last step, advancing with no
  saved path is a 404, and a too-large `stepIndex` is clamped.
- **Still open:** the dashboard does not rehydrate the saved path and make
  resuming it a first-class action, and completion is still several requests
  rather than one transactional command. Both land with the durable
  `lesson_sessions` aggregate.

### H9 — Speech cancellation and pause races

- **Status:** Confirmed, open. Phase 1. `src/hooks/useSpeech.ts` unchanged —
  one shared `finishRef`, `stop()` clears it without resolving the pending
  promise, and a new utterance overwrites pending completion state.

### H10 — Assessment authority split between model and client

- **Status:** Partially fixed — the end-of-lesson assessment is fully
  server-owned; mid-lesson checkpoints are not yet
- **Confirmed at:** `/api/lesson/quiz` returned the model's output with
  `correctAnswer` intact; `src/components/QuizPanel.tsx:58` compared the
  learner's text to that key with `===`; and `/api/lesson/report` accepted the
  browser's own `correct` flags, whose `scorePercent` went into the learner's
  permanent history.
- **Implementation:**
  - `src/lib/grading.ts` — the stored/learner split. `StoredQuestion` holds
    the key; `LearnerQuestion` is a projection where the key is *absent*, not
    blanked. Stable question and option ids are assigned when the quiz is
    generated, so grading compares ids rather than answer text.
  - `prepareQuiz` resolves the model's free-text `correctAnswer` to an option
    id once, tolerating the labels and punctuation models add ("B) 4", "4."),
    and drops a question whose stated answer matches none of its own options —
    an item every learner would fail whatever they picked.
  - New tables `lesson_quizzes` and `lesson_quiz_attempts` (migration
    `0002_quiz_grading.sql`). The attempt is keyed by quiz, which makes
    submission idempotent: a double click or a retry returns the stored
    outcome instead of grading — and paying for — the same answers twice.
  - New `POST /api/lesson/quiz/grade` grades against the stored key. MCQ is
    deterministic by option id; short answers go to `gradeShortAnswer`, a
    versioned rubric on the server, with the reference answer never leaving
    it and the learner's text explicitly fenced as untrusted data.
  - `POST /api/lesson/report` now takes a `quizId`, reads the stored attempt,
    and overrides the model's `scorePercent` with the stored one. The body no
    longer has a field that could carry marks at all.
  - `GRADER_VERSION`, `RUBRIC_VERSION` and `GENERATOR_VERSION` are persisted
    with each attempt so a mark stays interpretable after the rubric changes.
- **Tests:** `src/lib/grading.test.ts` (16) — no key in the projection, key
  resolution, ungradeable questions dropped, id-based grading, a submission
  that tries to assert its own correctness, partial credit and score bounds.
  `src/app/api/routes.test.ts` adds 7: the key never reaches the browser, a
  forged `correct: true` is ignored, re-submission replays without a second
  model call, another learner's quiz is a 404 for both grading and reporting,
  a report before grading is a 404, and the reported score comes from the
  attempt rather than the model.
- **Still open:** mid-lesson *checkpoints* still travel inside the lesson plan
  with their `correctAnswer`, and `checkpointResults` are still reported by
  the client. Closing that needs the plan to live server-side, which is the
  `lesson_sessions` work.

### H11 — Document ingestion is a synchronous serverless workload

- **Status:** Confirmed, open. Phase 2.
- **Partially bounded now:** file size, archive expansion, extracted-text
  length and the per-user upload rate all cap the work one request can start.
- **Still open:** parsing, chunking, embedding and concept extraction all still
  happen inside the 60-second request.

### H12 — No automated safety net

- **Status:** Partially fixed
- **Done now:** a zero-dependency test runner (Node's built-in `node:test`
  with type stripping; `tests/register.mjs` maps the `@/` alias and
  extensionless imports), 239 tests, and `npm run check` running lint +
  typecheck + tests together.
- **Still open:** no CI workflow, no React error boundaries, no component,
  browser, accessibility or load tests, no model contract tests against a real
  provider.

---

## Medium

| ID | Finding | Status | Notes |
| --- | --- | --- | --- |
| M1 | Older strong evidence overwrites newer weak evidence | **Fixed** | Extracted as `deriveConceptMastery`, a pure function with 7 tests. The rule is now what the comment always claimed: the most recent lesson mentioning a concept decides it, and older entries cannot change it. A concept listed both ways in one lesson resolves to weak — revisiting a known concept is cheaper than dropping one the learner has not grasped. |
| M2 | 50-row window presented as lifetime history | **Fixed** | `loadMemoryForUser` returns `historyTotal` and `historyWindow` alongside the window, and `LearnerDashboard` says "showing the N most recent of M lessons" when the list is truncated. |
| M3 | Chunk overlap misses ordinary paragraph boundaries | Open (Phase 2) | Config now guarantees `CHUNK_OVERLAP < CHUNK_MAX_CHARS` (an equal or larger overlap made the chunk loop stop advancing). The boundary behaviour in `src/lib/chunk.ts` is unchanged. |
| M4 | Node-side JSONB vector scan | Open (Phase 2) | Needs pgvector; requires a decision about the database extension (see "Awaiting your approval"). |
| M5 | No threshold, hybrid search, reranker or citations | Open (Phase 2) | |
| M6 | English-oriented embeddings vs multilingual product | Open (Phase 2) | Changing the model requires re-embedding every stored document — a data migration needing your approval. |
| M7 | Parse failure sits outside the provider retry loop | **Fixed** | `callModelSchema` parses *and* validates inside the operation, with bounded repair. Covered indirectly by the schema tests; a provider-level contract test is Phase 4. |
| M8 | Retry envelope can exceed route duration | **Fixed** | `TOTAL_DEADLINE_MS` (default 50s, under the 60s `maxDuration`). No attempt starts that cannot finish, and each attempt's timeout is clamped to the remaining budget. |
| M9 | Numeric config parser lacks integer and upper bounds | **Fixed** | `src/lib/appConfig.ts` now has `parseNumber`/`count`/`duration`/`ratio` with explicit domains. `MODEL_TEMPERATURE=0` is now accepted (it was silently replaced by 0.7); every token budget has a ceiling; `CHUNK_OVERLAP` falls back when it is not smaller than the chunk size. |
| M10 | No document deletion, retention or cleanup | Open (Phase 1) | |
| M11 | VideoRecorder track/object-URL/duration cleanup | Open (Phase 1) | |
| M12 | Accessibility gaps | Partially fixed | Graphs now carry a text alternative (`role="img"` plus a description of expression, domain and label) and diagrams carry an accessible name; a rejected diagram is announced as a note rather than being silent. Labels, focus management, live regions and reduced-motion remain Phase 3. |
| M13 | Password reset, verification, linking, export, deletion | Open (Phase 3) | |
| M14 | README does not match the implementation | Closed | Already corrected by commit `54ea286` before this session; verified — no OpenRouter, filesystem-storage or localStorage-memory references remain. A Security Model section and the new commands were added. |
| M15 | Migrations not versioned or constraint-rich | **Fixed** | `db/schema.sql` became `db/migrations/0001_baseline.sql`; `db/migrate.mjs` now applies numbered files once each, in one transaction apiece, recorded in `schema_migrations` with a checksum. Editing an applied migration is an error, not a silent no-op. `0003_constraints.sql` adds score-range, non-blank-identifier, non-negative-index and non-empty-path checks — all `NOT VALID`, so they bind new writes without a migration deciding what to do about pre-existing rows. 7 tests cover the planner. |
| M16 | Beta auth dependency, unpinned runtime | Partially fixed | `next-auth` pinned to the exact `5.0.0-beta.32` (no upgrade, just no drift). `engines` now pins Node ≥ 22.6 and npm ≥ 10. A tested upgrade plan for Auth.js v5 stable is still outstanding. |

## Low

| ID | Finding | Status | Notes |
| --- | --- | --- | --- |
| L1 | Hardcoded document accept list | **Fixed** | `src/components/HomeDashboard.tsx` now imports `DOCUMENT_ACCEPT_ATTRIBUTE`, the same value the parser and upload route validate against, so the picker cannot drift from what the server accepts. |
| L2 | Visible SAMPLE BUTTON placeholder | Open (Phase 3) | `src/components/SettingsDashboard.tsx:347`. Removing it or giving it real behaviour is a product decision, not a security one. |

---

## Migrations

| Version | What it does | Rollback | Backfill |
| --- | --- | --- | --- |
| `0001_baseline` | The pre-existing `db/schema.sql`, unchanged. Every statement is `IF NOT EXISTS`, so it is safe to run against a database that already has these tables — which is exactly what happens the first time an existing deployment runs the new runner. | Not applicable — this is the baseline. | None. |
| `0002_quiz_grading` | Adds `lesson_quizzes` and `lesson_quiz_attempts` for H10. | `DROP TABLE lesson_quiz_attempts, lesson_quizzes;` — destroys graded attempts, so only for a rollback that also reverts the application. | None. Lessons completed before this migration have their score in `learner_history_entries` already; there is no attempt row to reconstruct and none is needed. |
| `0003_constraints` | Adds `NOT VALID` CHECK constraints for M15. | `ALTER TABLE <t> DROP CONSTRAINT <name>;` for each. Non-destructive. | Optional: `ALTER TABLE <t> VALIDATE CONSTRAINT <name>;` once existing rows are known to be clean. Left to you deliberately — a migration should not decide what to do about pre-existing rows that violate a new rule. |

**Not applied anywhere.** `npm run migrate -- --status` lists what a database
has and what is pending; `npm run migrate` applies the rest. Run it against
staging before production.

## Awaiting your approval

1. **pgvector** (M4) — requires `CREATE EXTENSION vector` on your database and
   re-embedding existing documents. Not run; no remote database was touched.
2. **Embedding model change** (M6) — a multilingual model invalidates every
   stored vector, so it is a data migration.
3. **Object storage and a job queue** (H11) — an infrastructure provider
   choice. The interface can be built with a local adapter first.
4. **`SAMPLE BUTTON`** (L2) — implement or remove.
5. **`git-random.sh`** — not deleted, because it could not be proven unused
   (it is invoked by hand). It was rewritten to require an explicit identity
   and to pass it with `git -c` for that one commit, so it no longer randomises
   and no longer rewrites the checkout's `user.name`/`user.email`. Say the word
   and it goes entirely.

## Next implementation step

Phase 1 continues, in this order:

1. **H9** — rewrite `useSpeech` as an explicit state machine: per-utterance
   ids, exactly-once settlement, `AbortSignal` cancellation, watchdogs
   suspended during pause, preview isolated from lesson narration, and a
   manual "continue" fallback when the browser cannot narrate.
2. **M10/M11** — document deletion and retention; VideoRecorder track
   cleanup, object-URL revocation and duration/size caps.
3. **Durable `lesson_sessions`** — the server-owned aggregate that closes the
   rest of H8 (dashboard rehydration, one transactional completion), the rest
   of H10 (checkpoint keys off the client), and gives refresh-and-resume.
