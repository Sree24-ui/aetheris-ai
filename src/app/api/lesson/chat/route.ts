import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/llmError";
import { answerQuestion } from "@/lib/teachingAgent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { question, lessonTopic, sectionTitle, sectionContext, language, history } = body as {
      question?: string;
      lessonTopic?: string;
      sectionTitle?: string;
      sectionContext?: string;
      language?: string;
      history?: { role: "ai" | "user"; text: string }[];
    };

    if (!question || typeof question !== "string" || !question.trim()) {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    const result = await answerQuestion({
      question: question.trim(),
      lessonTopic: lessonTopic ?? "",
      sectionTitle: sectionTitle ?? "",
      sectionContext: sectionContext ?? "",
      language: language ?? "English",
      history: Array.isArray(history) ? history : [],
    });

    return NextResponse.json({
      answer: result.answer,
      suggestedFollowUps: Array.isArray(result.suggestedFollowUps)
        ? result.suggestedFollowUps.slice(0, 2)
        : [],
    });
  } catch (err) {
    console.error(err);
    const { body, status } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
