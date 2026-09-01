import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { loadMemoryForUser, addHistoryEntryForUser } from "@/lib/serverMemory";
import type { LearnerHistoryEntry } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const memory = await loadMemoryForUser(Number(session.user.id));
  return NextResponse.json(memory);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const entry: LearnerHistoryEntry = await req.json();
    if (!entry.id || !entry.topic || !entry.date) {
      return NextResponse.json({ error: "Missing required history fields" }, { status: 400 });
    }
    await addHistoryEntryForUser(Number(session.user.id), entry);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to save history entry" }, { status: 500 });
  }
}
