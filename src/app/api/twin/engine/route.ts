import { NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitTwinState } from "@/lib/twin/state";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";

// 실시간 엔진 상태/재고를 매 요청 라이브로 읽는다 — 프로덕션 빌드에서 정적 캐싱되면
// 패널이 오래된 스냅샷에 멈추므로 강제 동적 렌더링. (코드베이스 라이브-데이터 라우트 컨벤션)
// 읽기 전용이다. 시작/정지 POST는 2026-08-22에 제거했다 — 화면에서 클릭 한 번으로 팹이 서고
// 워치독은 PAUSED를 정상 상태로 보므로 되살려주지 않는다. 며칠간 결품이 안 풀린 원인이
// 정확히 "엔진이 연속으로 안 돌아서"였다. 정지는 프로세스 수준에서만 한다(ops:server:stop).
export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getOrInitTwinState();
  const { inventory, materials, twinPurchaseOrders, twinBurnEvents } = await collections();

  const materialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((r) => r.materialId))];
  const rows = await Promise.all(materialIds.map(async (materialId) => {
    const inv = await inventory.find({ materialId }).sort({ quantity: -1 }).limit(1).next();
    const mat = await materials.findOne({ _id: materialId });
    const openPOs = await twinPurchaseOrders.find({ materialId, status: { $ne: "RECEIVED" } }).toArray();
    const recent = await twinBurnEvents.find({ materialId }).sort({ tickAt: -1 }).limit(1).next();
    const avgDailyBurn = inv?.avgDailyBurn ?? 0;
    const ropDays = mat?.ropDays ?? 0;
    return {
      materialId,
      onHand: inv?.quantity ?? 0,
      avgDailyBurn,
      ropDays,
      rop: avgDailyBurn * ropDays,
      inTransit: openPOs.map((po) => ({ poId: po._id, qty: po.qty, etaAt: po.etaAt })),
      recentBurn: recent?.burnedQty ?? 0,
    };
  }));

  return NextResponse.json({ status: state.status, lastTickAt: state.lastTickAt, materials: rows });
}
