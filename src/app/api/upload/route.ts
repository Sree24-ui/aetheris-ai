import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { toErrorResponse } from "@/lib/llmError";
import { parseDocument } from "@/lib/documentParser";
import { ingestDocument } from "@/lib/vectorStore";
import { extractConcepts } from "@/lib/teachingAgent";
import type { DocumentSummary } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const text = await parseDocument(file.name, buffer);

    if (!text || text.trim().length < 20) {
      return NextResponse.json(
        { error: "Could not extract readable text from this file." },
        { status: 422 }
      );
    }

    const docId = randomUUID();
    const { numChunks, preview, sample } = await ingestDocument(docId, file.name, text);

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
    console.error(err);
    // An unsupported extension is the caller's mistake, not a server fault —
    // returning 400 lets the UI say so plainly instead of "something failed".
    const message = err instanceof Error ? err.message : "";
    if (/^Unsupported file type/.test(message)) {
      return NextResponse.json({ error: message, kind: "unsupported" }, { status: 400 });
    }
    const { body, status } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
