import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateAIBriefing } from "@/lib/ai";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { name?: string; role?: string };
  const briefing = await generateAIBriefing(
    user.name ?? "담당자",
    user.role ?? "MATERIALS"
  );

  return NextResponse.json(briefing);
}
