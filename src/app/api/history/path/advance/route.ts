import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { advancePathForUser } from "@/lib/serverMemory";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    await advancePathForUser(Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to advance learning path" }, { status: 500 });
  }
}
