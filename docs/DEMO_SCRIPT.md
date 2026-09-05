# Aetheris AI — 5-minute demo script

The judging weights are on the board: human-like teaching and adaptation (20), AI/ML (15), RAG (15), teaching video (15), multilingual (10), voice and avatar (10). This script spends its five minutes in that order and nowhere else.

## Before you press record

- [ ] Signed in, on the home screen, **not** mid-lesson (a restored session will resume instead of starting fresh).
- [ ] A short PDF or PPTX ready — 3–10 pages. Something with specific facts in it: named figures, dates, terms. Generic prose makes grounding invisible.
- [ ] Browser volume up; confirm an English voice speaks by starting any lesson for five seconds, then reload.
- [ ] Second tab on `/app` progress, already loaded.
- [ ] Close other tabs. Screen recording captures the whole tab.
- [ ] Know your deliberate wrong answer in advance (see 2:10).

**Time budget: pick "Quick Review" (5 minutes).** It produces 2–3 sections, which is the only length that fits a demo.

---

## 0:00–0:20 · The problem

> "Online learning gives you two things: recorded lectures that can't see you, and chatbots that answer whatever you happen to ask. Neither one *teaches*. Aetheris plans a lesson for you, teaches it out loud, stops to check whether it landed, and changes how it explains when it hasn't."

Stay on the home screen. Do not narrate the UI.

## 0:20–0:45 · Configure the learner

Show, quickly:
- **Upload** the document (this is the RAG evidence — do it on camera).
- Level **Beginner**, **Quick Review (5m)**, language **English**.
- Optionally paste the free-text line: *"Teach me chapter 2 in 20 minutes in Hindi"* and show the form filling itself in — then set it back.

> "Level, language, time, and the material itself. Everything after this is built for that profile."

Watch the ingestion progress reach 100%.

## 0:45–1:15 · Planning

Start the lesson. While it plans:

> "One model call turns that document into a lesson plan: sections sized to five minutes, at beginner level, each with a visual and a checkpoint question — and the answer keys stay on the server, which matters later."

When the lesson opens, point at the section counter: **"Section 1 of 3."**

## 1:15–2:10 · The teacher (voice + avatar + visuals)

Let it teach. Do not talk over the first fifteen seconds — the judge needs to hear the voice and see the mouth move.

Then point out, in this order:
1. The **avatar** — speaking, blinking, breathing.
2. The **captions** under it.
3. The **visual aid** — the equation, diagram or code the planner chose for this section.
4. If the content came from the document, say so: *"that figure is from the PDF, not from the model's general knowledge."*

> "This is the teaching video. The avatar, the voice and the export are all browser-native — no avatar vendor, no per-minute cost."

**Optional, 5 seconds:** click **Record teaching video**, choose *This Tab*, enable tab audio. Mention it produces a real downloadable `.webm`. Skip if the picker is slow.

## 2:10–2:50 · The checkpoint, and the adaptation ⭐

**This is the highest-scoring 40 seconds of the demo. Do not rush it.**

When the checkpoint appears:

1. **Answer it wrong on purpose.** Something plausibly wrong, not gibberish — invert a relationship, swap two terms.
2. Read the response out loud, and name what it did:
   > "It didn't just say incorrect. It named the misconception — *that* specific wrong mental model — and it's re-explaining with a different analogy than the section used."
3. Click **Continue lesson**, reach the next checkpoint, and **get it wrong again**.
4. Point at the chip beside the section counter, now reading **"Simplifying"**:
   > "Two wrong in a row, so the teaching stance changed. It won't repeat the explanation that just failed — it breaks the idea into a smaller step with a concrete example. Two right in a row and it goes the other way: 'Raising the challenge'. That's decided on the server, from the outcomes the server graded — the browser can't influence it."

If time allows, get the next one **right** and show the chip return to **"On track"**.

## 2:50–3:15 · Ask Teacher

Open the **Ask teacher** tab. Ask something real about the current section — *"why does that step work?"*

> "Separate from the lesson. It knows what's being taught right now, it's never graded, and it doesn't drag the lesson off course."

## 3:15–3:50 · Multilingual

Change the language dropdown to **Hindi**.

> "The lesson isn't subtitled — it's re-expressed. The caption, the transcript above it and the active question all move together."

Point at the transcript: earlier bubbles are now Hindi too. Then:

> "And your own answers stay in your words. Those are yours."

If you switch to a language the machine has no voice for (Marathi on macOS), point at the notice:
> "No Marathi voice on this device — so it says so and keeps going at reading pace. Nothing freezes."

**Switch back to English** before the assessment, so the report is readable.

## 3:50–4:30 · Assessment and report

Finish the lesson. Take the final quiz — answer honestly, a mix.

Show the report:
- **Score** — *"graded on the server, against a key the browser never received."*
- **Strong areas / weak areas**
- **Recommendation** and **suggested next topic**

## 4:30–4:50 · Progress, and how it's built

Open **Progress**. The lesson is there with its topic, language and score.

> "Written in one transaction with the learning-path advance, and idempotent — retrying can't duplicate it."

Close on the architecture line:

> "Next.js and Postgres. Groq or Gemini, interchangeable, with failover. Embeddings run in-process, so retrieval costs nothing. Hybrid lexical-plus-vector retrieval fused by reciprocal rank. Five hundred and nine tests. And the server owns every answer key, every grade and the lesson's own state — which is what makes the assessment mean anything."

---

## If something goes wrong on camera

| Symptom | Do this |
|---|---|
| No narration | Say *"this device has no voice for that language — captions carry it"* and keep going. It is a designed path, not a failure. |
| Lesson seems stuck mid-section | Press **Play** — it re-runs the section. Or **Skip narration**. |
| Model call fails | Retry once. The circuit breaker will have failed over if both providers are configured. |
| Ingestion slow | Keep talking over it; mention it is a resumable checkpointed job. |
| Quiz slow | *"It's generating questions from the concepts actually taught, not from a bank."* |

## What not to demo

- The landing page. Start signed in.
- Settings, appearance, account export.
- A 60-minute lesson. It will not fit.
- Anything in Known Limitations, unless a judge asks — then answer plainly.
