import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { getWarehouseCapacity } from "@/lib/queries";

export const dynamic = "force-dynamic";

// 박물류 CAPACITY_OVER로 실제 입고가 보류된 화물 목록 — 창고 용량(배정 당시 게이팅 사유)과
// 해당 자재의 결품 위험(coverage days)을 함께 보여줘서, 사람이 "용량초과 vs 결품위험" 두
// 신호를 동시에 보고 판단하게 한다.
export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { twinPurchaseOrders, materials, inventory } = await collections();
  const [held, warehouseCapacity] = await Promise.all([
    twinPurchaseOrders.find({ status: "INBOUND_HOLD" }).sort({ orderedAt: 1 }).toArray(),
    getWarehouseCapacity(),
  ]);
  const materialIds = [...new Set(held.map((po) => po.materialId))];
  const [matDocs, invDocs] = await Promise.all([
    materials.find({ _id: { $in: materialIds } }).toArray(),
    inventory.find({ materialId: { $in: materialIds } }).toArray(),
  ]);
  const matById = new Map(matDocs.map((m) => [m._id, m]));
  const whByCode = new Map(warehouseCapacity.map((wh) => [wh.id, wh]));
  const invByMat = new Map<string, { quantity: number; avgDailyBurn: number }>();
  for (const d of invDocs) {
    const prev = invByMat.get(d.materialId);
    if (!prev || d.quantity > prev.quantity) invByMat.set(d.materialId, { quantity: d.quantity, avgDailyBurn: d.avgDailyBurn ?? 0 });
  }

  const items = held.map((po) => {
    const mat = matById.get(po.materialId);
    const inv = invByMat.get(po.materialId);
    const wh = po.destinationWarehouseId ? whByCode.get(po.destinationWarehouseId) : undefined;
    const coverageDays = inv && inv.avgDailyBurn > 0 ? inv.quantity / inv.avgDailyBurn : null;
    return {
      id: po._id,
      materialId: po.materialId,
      materialCode: mat?.code ?? po.materialId,
      materialName: mat?.name ?? po.materialId,
      unit: mat?.unit ?? "",
      qty: po.qty,
      orderedAt: po.orderedAt.toISOString(),
      warehouseCode: wh?.code ?? po.destinationWarehouseId ?? null,
      warehouseName: wh?.name ?? null,
      warehouseUtilization: wh ? Math.max(wh.utilization, wh.legalUtilization ?? 0) : null,
      coverageDays,
      ropDays: mat?.ropDays ?? null,
      waitingMinutes: Math.round((Date.now() - po.orderedAt.getTime()) / 60_000),
    };
  });

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
