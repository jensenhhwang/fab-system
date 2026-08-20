import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";

// 트렌드 화면의 유일한 데이터원. 스냅샷 컬렉션만 읽고 파생 계산은 하지 않는다 —
// 집계는 적재 시점(engine tick)에 이미 끝나 있다.
export const dynamic = "force-dynamic";

const MAX_DAYS = 90;

export async function GET(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { twinDailySnapshots } = await collections();
  const axis = req.nextUrl.searchParams.get("axis") === "wall" ? "wall" : "operating";
  const requested = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), MAX_DAYS) : 30;

  const points = await twinDailySnapshots.find({}).sort({ operatingDay: -1 }).limit(days).toArray();
  points.reverse();

  // 적재 시작일 — 백필하지 않으므로 화면이 "언제부터의 기록인지"를 밝혀야 한다.
  const first = await twinDailySnapshots.find({}).sort({ operatingDay: 1 }).limit(1).next();

  return NextResponse.json({
    axis,
    days,
    startedAt: first?.recordedAt ?? null,
    startedOperatingDay: first?.operatingDay ?? null,
    points,
  });
}
