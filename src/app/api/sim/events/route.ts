import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);
  const { simEvents } = await collections();
  const events = await simEvents.find({}).sort({ simDate: -1 }).limit(limit).toArray();
  return NextResponse.json(events);
}
