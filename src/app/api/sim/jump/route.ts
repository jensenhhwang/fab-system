import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  void req;
  return NextResponse.json({ error: "타임 액셀러레이터는 종료되었습니다. 운영 What-if를 사용하세요." }, { status: 410 });
  /* legacy path retained for migration reference
  const { searchParams } = req.nextUrl;
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30"), 1), 365);

  const allEvents: SimEventDoc[] = [];
  for (let i = 0; i < days; i++) {
    const result = await executeTickAndPersist();
    allEvents.push(...result.newEvents);
  }

  return NextResponse.json({ days, eventCount: allEvents.length, events: allEvents.slice(-50) }); */
}
