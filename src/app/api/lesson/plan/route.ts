import { NextRequest, NextResponse } from "next/server";
import { planLesson } from "@/lib/teachingAgent";
import { searchDocument, documentExists } from "@/lib/vectorStore";
import type { LearnerProfile } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, profile, docId } = body as {
      topic: string;
      profile: LearnerProfile;
      docId?: string;
    };

    if (!topic || !profile) {
      return NextResponse.json({ error: "Missing topic or profile" }, { status: 400 });
    }

    let groundedContext: string | undefined;
    let isDocumentGrounded = false;

    if (docId) {
      const exists = await documentExists(docId);
      if (!exists) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      const results = await searchDocument(docId, topic, 10);
      groundedContext = results.map((r, i) => `[Excerpt ${i + 1}]\n${r.text}`).join("\n\n");
      isDocumentGrounded = true;
    }

    const plan = await planLesson({ topic, profile, groundedContext, isDocumentGrounded });
    return NextResponse.json(plan);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
