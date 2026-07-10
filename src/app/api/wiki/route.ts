import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { title, category, content, result, nextAction } = await req.json();
  if (!title || !category || !content) {
    return NextResponse.json({ error: "필수 항목 누락" }, { status: 400 });
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) return NextResponse.json({ error: "User ID not found" }, { status: 400 });

  const entry = await db.wikiEntry.create({
    data: {
      date: new Date(),
      title,
      category,
      content,
      result: result || null,
      nextAction: nextAction || null,
      userId,
    },
  });

  return NextResponse.json(entry);
}
