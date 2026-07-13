import { NextRequest, NextResponse } from "next/server";
import { executeTickAndPersist } from "@/lib/sim-runner";
import type { SimEventDoc } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30"), 1), 365);

  const allEvents: SimEventDoc[] = [];
  for (let i = 0; i < days; i++) {
    const result = await executeTickAndPersist();
    allEvents.push(...result.newEvents);
  }

  return NextResponse.json({ days, eventCount: allEvents.length, events: allEvents.slice(-50) });
}
