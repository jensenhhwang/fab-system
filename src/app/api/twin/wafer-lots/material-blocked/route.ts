import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";
import { getRouteMaster, expandRouteMaster } from "@/lib/route-master";
import { buildStepConsumption, type StepConsumption } from "@/lib/twin/burn";
import { coverageState, criticalMaterialIds, type MaterialSignal } from "@/lib/materials-agent";

export const dynamic = "force-dynamic";

// 이자재 COVERAGE_CRITICAL 판정으로 advanceAggregateWip가 진행을 막은 로트들을
// 다음 스텝에서 걸리는 자재별로 묶어 보여준다(개별 로트 수천 개를 나열하지 않는다).
// 재고가 회복되면 advanceAggregateWip가 다음 tick에 자동으로 다시 진행시키므로
// 여기엔 승인/해제 액션이 없다 — 순수 조회용 패널이다.
export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { waferLots, materials, inventory } = await collections();

  const routeMaster = await getRouteMaster("M20", "HBM");
  const stepConsumption: StepConsumption = routeMaster
    ? buildStepConsumption(expandRouteMaster(routeMaster), [...M20_MATERIAL_CONSUMPTION])
    : new Map();

  const materialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((r) => r.materialId))];
  const [matDocs, invDocs, groups] = await Promise.all([
    materials.find({ _id: { $in: materialIds } }).toArray(),
    inventory.find({ materialId: { $in: materialIds } }).toArray(),
    waferLots.aggregate<{ _id: number; lotCount: number; waferQty: number; blockedSince: Date }>([
      { $match: { fabId: "M20", product: "HBM", materialBlockedAt: { $exists: true } } },
      { $group: { _id: "$currentStepIndex", lotCount: { $sum: 1 }, waferQty: { $sum: "$waferQty" }, blockedSince: { $min: "$materialBlockedAt" } } },
      { $sort: { _id: 1 } },
    ]).toArray(),
  ]);

  const matById = new Map(matDocs.map((m) => [m._id, m]));
  const invByMat = new Map<string, { quantity: number; avgDailyBurn: number }>();
  for (const d of invDocs) {
    const prev = invByMat.get(d.materialId);
    if (!prev || d.quantity > prev.quantity) invByMat.set(d.materialId, { quantity: d.quantity, avgDailyBurn: d.avgDailyBurn ?? 0 });
  }
  const materialSignals: MaterialSignal[] = materialIds.flatMap((id) => {
    const inv = invByMat.get(id);
    const mat = matById.get(id);
    if (!inv || !mat) return [];
    const dailyBurn = inv.avgDailyBurn;
    return [{
      materialId: id, code: mat.code, name: mat.name, unit: mat.unit, ropDays: mat.ropDays,
      quantity: inv.quantity, dailyBurn,
      coverageDays: dailyBurn > 0 ? inv.quantity / dailyBurn : null,
      state: coverageState(inv.quantity, dailyBurn, mat.ropDays),
    }];
  });
  const blockedMaterialIds = criticalMaterialIds(materialSignals);
  const signalById = new Map(materialSignals.map((s) => [s.materialId, s]));

  const items = groups.map((g) => {
    const consumers = stepConsumption.get(g._id) ?? [];
    const blockingMaterials = consumers
      .filter((c) => blockedMaterialIds.has(c.materialId))
      .map((c) => signalById.get(c.materialId))
      .filter((s): s is MaterialSignal => Boolean(s))
      .map((s) => ({ code: s.code, name: s.name, coverageDays: s.coverageDays, ropDays: s.ropDays }));
    return {
      stepIndex: g._id,
      lotCount: g.lotCount,
      waferQty: g.waferQty,
      waitingMinutes: Math.round((Date.now() - new Date(g.blockedSince).getTime()) / 60_000),
      materials: blockingMaterials,
    };
  });

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
