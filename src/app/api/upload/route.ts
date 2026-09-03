import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { MIN_EXTRACTED_CHARS } from "@/lib/appConfig";
import { toErrorResponse } from "@/lib/llmError";
import { parseDocument } from "@/lib/documentParser";
import { ingestDocument } from "@/lib/vectorStore";
import { extractConcepts } from "@/lib/teachingAgent";
import type { DocumentSummary } from "@/lib/types";

export const runtime = "nodejs";
// Kept under the 60s ceiling that Vercel's Hobby tier enforces: a higher
// value is not honoured there, and the platform kills the function before
// this route's own timeout fires, leaving nothing useful in the logs.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    // Middleware already rejects anonymous callers, but the owning user id is
    // needed here to scope the stored document, so resolve the session rather
    // than trusting anything in the request body.
    const session = await auth();
    const userId = Number(session?.user?.id);
    if (!Number.isFinite(userId)) {
      return NextResponse.json({ error: "You need to be signed in to upload.", kind: "auth" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const text = await parseDocument(file.name, buffer);

    if (!text || text.trim().length < MIN_EXTRACTED_CHARS) {
      return NextResponse.json(
        { error: "Could not extract readable text from this file." },
        { status: 422 }
      );
    }

    const docId = randomUUID();
    const { numChunks, preview, sample } = await ingestDocument(docId, userId, file.name, text);

    // The document itself is already indexed and usable at this point, so a
    // failed concept extraction must not fail the whole upload — but it does
    // need to be reported, or an empty tag list looks like a broken upload.
    let concepts: string[] = [];
    let conceptsWarning: string | undefined;
    try {
      concepts = await extractConcepts(sample);
    } catch (err) {
      const { body } = toErrorResponse(err);
      conceptsWarning = `Document indexed, but key concepts couldn't be extracted. ${body.error}`;
    }

    const summary: DocumentSummary = {
      docId,
      filename: file.name,
      numChunks,
      language: "auto",
      preview,
      concepts,
      conceptsWarning,
    };
    return NextResponse.json(summary);
  } catch (err) {
    // An unsupported extension is the caller's mistake, not a server fault —
    // returning 400 lets the UI say so plainly instead of "something failed".
    // Logged as a one-line warning rather than console.error: a stack trace for
    // an expected client error is noise that buries the failures that matter.
    const message = err instanceof Error ? err.message : "";
    if (/^Unsupported file type/.test(message)) {
      console.warn(`[upload] rejected: ${message}`);
      return NextResponse.json({ error: message, kind: "unsupported" }, { status: 400 });
    }
    console.error(err);
    const { body, status } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
