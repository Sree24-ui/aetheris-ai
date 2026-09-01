import { NextRequest, NextResponse } from "next/server";
import { generateLearningPath } from "@/lib/teachingAgent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const path = await generateLearningPath(body);
    return NextResponse.json(path);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
