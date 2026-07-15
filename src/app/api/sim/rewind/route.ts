import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.simulation);
  if (access.error) return access.error;
  const { searchParams } = req.nextUrl;
  const dateStr = searchParams.get("date");
  if (!dateStr) return NextResponse.json({ error: "date 파라미터 필수 (YYYY-MM-DD)" }, { status: 400 });

  const targetDate = new Date(dateStr);
  if (isNaN(targetDate.getTime())) return NextResponse.json({ error: "유효하지 않은 날짜" }, { status: 400 });

  const { simState, inventoryLots, inventoryMovements, simPurchaseOrders, simEvents, simCheckpoints } =
    await collections();

  // target 날짜 이하의 가장 가까운 체크포인트 탐색
  const checkpoint = await simCheckpoints.findOne(
    { simDate: { $lte: targetDate } },
    { sort: { simDate: -1 } }
  );
  if (!checkpoint) return NextResponse.json({ error: "해당 날짜의 체크포인트 없음 — 더 이른 날짜로 시도하세요" }, { status: 404 });

  // 1. 실제 lot 수량 복원
  await Promise.all(
    checkpoint.realLotStates.map(s =>
      inventoryLots.updateOne(
        { _id: s.lotId },
        { $set: { availableQuantity: s.availableQuantity, qualityStatus: s.qualityStatus, updatedAt: new Date() } }
      )
    )
  );

  // 2. 체크포인트 날짜 이후에 생성된 시뮬레이션 데이터 삭제
  await Promise.all([
    inventoryLots.deleteMany({ simulated: true, receivedAt: { $gt: checkpoint.simDate } }),
    inventoryMovements.deleteMany({ simulated: true, createdAt: { $gt: checkpoint.simDate } }),
    simPurchaseOrders.deleteMany({ simulated: true, createdSimDate: { $gt: checkpoint.simDate } }),
    simEvents.deleteMany({ simulated: true, simDate: { $gt: checkpoint.simDate } }),
    simCheckpoints.deleteMany({ simDate: { $gt: checkpoint.simDate } }),
  ]);

  // 3. simState를 체크포인트 날짜로 되돌리기
  await simState.updateOne(
    { _id: "singleton" },
    { $set: { status: "PAUSED", simDate: checkpoint.simDate, speedMultiplier: 1 } }
  );

  return NextResponse.json({
    restoredTo: checkpoint.simDate,
    lotsRestored: checkpoint.realLotStates.length,
  });
}
