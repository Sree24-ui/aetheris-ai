import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/llmError";
import { generateReport } from "@/lib/teachingAgent";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const report = await generateReport(body);
    return NextResponse.json(report);
  } catch (err) {
    console.error(err);
    // Preserves the real cause (quota, bad key, timeout) and its status code
    // instead of flattening every failure into an opaque 500.
    const { body, status } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
