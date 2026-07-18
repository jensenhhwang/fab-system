import { NextRequest, NextResponse } from "next/server";
import { buildLiveDailyControl } from "@/lib/daily-control-live";
import { getActualsForDate, todayKST } from "@/lib/production-actuals";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? todayKST();
  const [rows, actuals] = await Promise.all([buildLiveDailyControl(date), getActualsForDate(date)]);
  return NextResponse.json({ date, rows, actuals }, { headers: { "Cache-Control": "no-store" } });
}
