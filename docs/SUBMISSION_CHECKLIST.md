# Aetheris AI — submission checklist

Deadline: **5 September, 5:00 PM IST**. Work top to bottom; everything above the line is required to submit.

## 1. Code is committed and pushed

The working tree currently holds a large body of reviewed-but-uncommitted work.

```bash
cd ai-teacher
git status
git diff --stat
npm run check && npm run build     # both must pass before committing
git add -A
git commit -m "feat: adaptive teaching, teacher avatar states, stability and docs"
git push origin main
```

- [ ] `npm run check` passes (eslint + tsc + tests)
- [ ] `npm run build` passes
- [ ] Committed and pushed to the submission branch
- [ ] `.env.local` is **not** in the commit (`git status` should never list it)
- [ ] Repository is accessible to the judges (public, or the graders invited)

## 2. Production deployment

- [ ] Deployed and reachable at the submission URL
- [ ] The deployed commit is the one you just pushed
- [ ] Home page loads signed out; `/app` redirects to sign-in

### Environment variables set on the host

| Variable | Set? | Notes |
|---|---|---|
| `DATABASE_URL` | ☐ | Production PostgreSQL |
| `AUTH_SECRET` | ☐ | `openssl rand -base64 32`, **different** from local |
| `GROQ_API_KEY` *or* `GEMINI_API_KEY` | ☐ | At least one |
| `LLM_PROVIDER` | ☐ | `groq` (default) or `gemini` |
| `LLM_FALLBACK_PROVIDER` | ☐ | Optional but recommended — survives one provider dying mid-demo |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ☐ | Only if Google sign-in is part of the demo |
| `AUTH_TRUST_HOST` | ☐ | Required when self-hosting behind a proxy |

- [ ] No secret is echoed in build logs

## 3. Google OAuth production callback

- [ ] `https://<production-domain>/api/auth/callback/google` added to the OAuth client's **Authorized redirect URIs**
- [ ] `https://<production-domain>` added to **Authorized JavaScript origins**
- [ ] Signed in on production at least once, in a fresh incognito window

## 4. Database migrations

```bash
DATABASE_URL="<production url>" npm run migrate -- --status
DATABASE_URL="<production url>" npm run migrate
```

- [ ] `--status` reports nothing pending after the run
- [ ] A lesson completed on production writes a history row (check Progress)

Migrations are forward-only and immutable. Do not edit an applied file; add a new one.

## 5. End-to-end smoke test on production

Do this **on the production URL**, in an incognito window, before recording anything.

- [ ] Sign in
- [ ] Topic-only lesson: configure → plan → teach → checkpoint → complete
- [ ] Upload lesson: PDF or PPTX → ingestion reaches 100% → the lesson visibly uses the material
- [ ] Deliberate wrong answer → misconception + re-explanation appears
- [ ] Second wrong answer → the stance chip reads **Simplifying**
- [ ] Ask Teacher answers in context
- [ ] Language switch mid-lesson updates caption, transcript and the active question
- [ ] Final quiz → grade → report with score, strong/weak areas, recommendation
- [ ] Progress lists the completed lesson with its real topic and language
- [ ] Reload mid-lesson → it resumes where it was

## 6. Demo video

- [ ] Recorded, following [`DEMO_SCRIPT.md`](DEMO_SCRIPT.md)
- [ ] Under the required length
- [ ] Audio is audible — the narration voice is a scored feature, so it must be heard
- [ ] The **wrong answer → adaptation** moment is clearly visible (highest-weighted 40 seconds)
- [ ] The uploaded document is visibly used
- [ ] Uploaded and the link is publicly viewable **without sign-in** — check in incognito

## 7. Documentation

- [ ] [`README.md`](../README.md) — every required section, no invented capability
- [ ] Architecture diagrams render on the submission platform (Mermaid; GitHub renders it natively)
- [ ] Third-party services and models disclosed
- [ ] Known Limitations present and honest
- [ ] [`docs/OPERATIONS.md`](OPERATIONS.md) and [`docs/REMEDIATION-LEDGER.md`](REMEDIATION-LEDGER.md) reachable from the README

## 8. Submission form

- [ ] GitHub repository URL
- [ ] Live application URL
- [ ] Demo video URL
- [ ] Team / contact details
- [ ] Any required write-up pasted from the README rather than rewritten
- [ ] **Submitted** — with time to spare, not at 16:59

---

## Requirement coverage, for the write-up

| # | Requirement | Status | Where to see it |
|---|---|---|---|
| 1 | Learning from uploaded material | ✅ | Upload a PDF; the lesson cites its specifics |
| 2 | Topic-based teaching | ✅ | Configure with a topic and no upload |
| 3 | AI-generated lesson structure | ✅ | Section counter, per-section visuals and checkpoints |
| 4 | Personalized teaching | ✅ | Level / language / time / style change the plan |
| 5 | Human-like teaching interaction | ✅ | Narrate → question → evaluate → remediate → continue |
| 6 | Video-based AI teacher | ✅ | The live lesson, plus a downloadable `.webm` |
| 7 | AI voice | ✅ | Web Speech API narration |
| 8 | Human-like avatar | ✅ | Six teaching expressions, blinking, gaze, breathing |
| 9 | Multilingual | ✅ | 22 languages, live mid-lesson switch |
| 10 | Questioning and assessment | ✅ | Checkpoints + final quiz, both graded server-side |
| 11 | Adaptive response | ✅ | Misconception detection + the visible stance chip |
| 12 | Working prototype | ✅ | The deployed application |

## Known gaps to state rather than hide

- Legacy `.doc` / `.ppt` are not supported; `.pdf`, `.docx`, `.pptx`, `.txt`, `.md` are.
- Ask Teacher is grounded in the current lesson section, not re-retrieved from the document.
- Vector search runs in Node; pgvector is written but not applied.
- Ingestion slices are driven by the browser, not a background worker.
- No automated browser tests — 509 unit and integration tests, no component or accessibility suite.
