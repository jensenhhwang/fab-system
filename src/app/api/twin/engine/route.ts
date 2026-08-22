import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { getOrInitTwinState } from "@/lib/twin/state";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";
import {
  isRoleAutomationReady,
  OPERATION_ROLE_OWNERS,
  ROLE_AUTOMATION_GATE_CODE,
} from "@/lib/operations-automation-gate-server";

// 실시간 엔진 상태/재고를 매 요청 라이브로 읽는다 — 프로덕션 빌드에서 정적 캐싱되면
// 패널이 오래된 스냅샷에 멈추므로 강제 동적 렌더링. (코드베이스 라이브-데이터 라우트 컨벤션)
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

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.simulation);
  if (access.error) return access.error;

  const body = await req.json() as { action?: "start" | "pause" };
  if (body.action !== "start" && body.action !== "pause") {
    return NextResponse.json({ error: "action은 start|pause" }, { status: 400 });
  }

  // 기존 Twin은 공정·재고·발주·입고를 한 Tick에서 직접 변경한다. 역할별 Executor로
  // 이관되기 전에는 API나 UI에서 실수로 다시 켤 수 없도록 fail-closed 한다.
  if (body.action === "start" && !isRoleAutomationReady()) {
    return NextResponse.json({
      error: "담당자별 실행 체계 이관 전에는 Twin을 재시작할 수 없습니다.",
      code: ROLE_AUTOMATION_GATE_CODE,
      status: "PAUSED",
      roleOwners: OPERATION_ROLE_OWNERS,
    }, { status: 409 });
  }

  await getOrInitTwinState();
  const { twinEngineState } = await collections();
  if (body.action === "start") {
    await twinEngineState.updateOne(
      { _id: "singleton" },
      { $set: { status: "RUNNING" }, $unset: { pausedAt: "", pausedBy: "" } },
    );
    return NextResponse.json({ ok: true, status: "RUNNING" });
  }

  const pausedAt = new Date();
  await twinEngineState.updateOne(
    { _id: "singleton" },
    { $set: { status: "PAUSED", pausedAt, pausedBy: access.user.id } },
  );
  return NextResponse.json({ ok: true, status: "PAUSED", pausedAt });
}
