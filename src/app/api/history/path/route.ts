import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { setCurrentPathForUser } from "@/lib/serverMemory";
import type { LearningPath } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const { path, stepIndex }: { path: LearningPath; stepIndex: number } = await req.json();
    if (!path?.topic || !Array.isArray(path?.steps)) {
      return NextResponse.json({ error: "Invalid learning path" }, { status: 400 });
    }
    await setCurrentPathForUser(Number(session.user.id), path, stepIndex ?? 0);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save learning path" }, { status: 500 });
  }
}
