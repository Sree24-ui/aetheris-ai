import { NextRequest, NextResponse } from "next/server";
import { translateSection } from "@/lib/teachingAgent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const section = await translateSection(body);
    return NextResponse.json(section);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
