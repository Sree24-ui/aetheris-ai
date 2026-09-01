import { NextRequest, NextResponse } from "next/server";
import { generateReport } from "@/lib/teachingAgent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const report = await generateReport(body);
    return NextResponse.json(report);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
