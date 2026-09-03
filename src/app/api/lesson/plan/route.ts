import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toErrorResponse } from "@/lib/llmError";
import { planLesson } from "@/lib/teachingAgent";
import { searchDocument, documentExists } from "@/lib/vectorStore";
import type { LearnerProfile } from "@/lib/types";

export const runtime = "nodejs";
// Kept under the 60s ceiling that Vercel's Hobby tier enforces: a higher
// value is not honoured there, and the platform kills the function before
// this route's own timeout fires, leaving nothing useful in the logs.
export const maxDuration = 60;

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
      // Documents are owned, so the lookup is scoped to the signed-in user.
      // Without this, a valid docId from anyone's upload would ground anyone
      // else's lesson.
      const session = await auth();
      const userId = Number(session?.user?.id);
      if (!Number.isFinite(userId)) {
        return NextResponse.json(
          { error: "You need to be signed in to use uploaded material.", kind: "auth" },
          { status: 401 }
        );
      }
      const exists = await documentExists(docId, userId);
      if (!exists) {
        return NextResponse.json({ error: "Document not found" }, { status: 404 });
      }
      const results = await searchDocument(docId, userId, topic);
      groundedContext = results.map((r, i) => `[Excerpt ${i + 1}]\n${r.text}`).join("\n\n");
      isDocumentGrounded = true;
    }

    const plan = await planLesson({ topic, profile, groundedContext, isDocumentGrounded });
    return NextResponse.json(plan);
  } catch (err) {
    console.error(err);
    // Preserves the real cause (quota, bad key, timeout) and its status code
    // instead of flattening every failure into an opaque 500.
    const { body, status } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
