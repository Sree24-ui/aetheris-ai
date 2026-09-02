import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { rows } = await pool.query(
    `SELECT name, email, image, created_at FROM users WHERE id = $1`,
    [Number(session.user.id)]
  );
  const user = rows[0];
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  return NextResponse.json({
    name: user.name,
    email: user.email,
    image: user.image,
    createdAt: user.created_at,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { name } = await req.json();
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  await pool.query(`UPDATE users SET name = $1 WHERE id = $2`, [
    name.trim(),
    Number(session.user.id),
  ]);
  return NextResponse.json({ ok: true });
}
