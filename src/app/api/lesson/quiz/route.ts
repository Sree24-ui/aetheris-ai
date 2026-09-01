import { NextRequest, NextResponse } from "next/server";
import { generateQuiz } from "@/lib/teachingAgent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const quiz = await generateQuiz(body);
    return NextResponse.json(quiz);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
