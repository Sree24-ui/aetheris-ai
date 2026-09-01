import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
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
    const concepts = await extractConcepts(sample);

    const summary: DocumentSummary = {
      docId,
      filename: file.name,
      numChunks,
      language: "auto",
      preview,
      concepts,
    };
    return NextResponse.json(summary);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: (err as Error).message || "Failed to process document" },
      { status: 500 }
    );
  }
}
