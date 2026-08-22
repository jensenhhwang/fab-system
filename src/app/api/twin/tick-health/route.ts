import { NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections } from "@/lib/db";
import { getWarehouseCapacity } from "@/lib/queries";
import { warehouseVerdict } from "@/lib/logistics-agent";
import { coverageState } from "@/lib/materials-agent";
import { materialConsumptionFor } from "@/lib/material-consumption";
import { ACTIVE_PRODUCTION_PRODUCTS, getProductionConfig } from "@/lib/fab-production-config";
import { finishedGoodsWarehouseIds } from "@/lib/finished-goods";
import { diagnoseTick, type TickDiagnosisInput } from "@/lib/twin/tick-diagnosis";

export const dynamic = "force-dynamic";

// 관측 구간 — 최근 이만큼의 소모 이벤트로 충족률을 계산한다. tick 하나만 보면 표본이
// 너무 작고, 전체 이력을 보면 옛날 정상 가동 구간에 희석된다.
const FULFILLMENT_WINDOW_TICKS = 20;

// EMA 아사 판정 — 발주 기준선(avgDailyBurn)이 설계수요 대비 이 비율 밑으로 떨어진 자재가 있으면
// 아사 나선으로 본다.
//
// 최근 소모 이벤트의 충족률로 판정하면 안 된다: 생산이 완전히 멈추면 새 소모 이벤트가 아예 안
// 생겨서 관측창이 옛 정상 구간에 머물고, 가장 심하게 굶고 있을 때 오히려 지표가 건강해 보인다
// (실관측: 산출 정지 27시간째인데 최근 20 tick 충족률 98%). 그래서 이벤트가 아니라 재고 원장의
// avgDailyBurn을 설계수요와 직접 비교한다.
const EMA_STARVATION_RATIO = 0.5;

// "지금 팹이 살아있나, 죽었으면 뭐 때문인가, 누가 풀 수 있나"를 한 번에 답하는 엔드포인트.
// 신규 컬렉션 없이 기존 원장(twinBurnEvents·finishedGoodsEvents·inventory·twinPurchaseOrders)에서
// 유도한다 — tick 자체의 산출물 기록(twinTickEvents)은 엔진 정리가 끝난 뒤 얹는다.
export async function GET() {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const { twinEngineState, twinBurnEvents, finishedGoodsEvents, twinPurchaseOrders, inventory, materials } = await collections();
  const now = new Date();

  const [state, lastOutput, pendingApprovalCount, inboundHoldCount] = await Promise.all([
    twinEngineState.findOne({ _id: "singleton" }),
    finishedGoodsEvents.find({ addedQty: { $gt: 0 } }).sort({ tickAt: -1 }).limit(1).next(),
    twinPurchaseOrders.countDocuments({ status: "PENDING_APPROVAL" }),
    twinPurchaseOrders.countDocuments({ status: "INBOUND_HOLD" }),
  ]);

  // 최근 N tick의 소모/부족 합 — tickAt으로 묶어서 tick 단위 구간을 잡는다.
  const recentTicks = await twinBurnEvents.aggregate<{ _id: Date; burned: number; shortfall: number }>([
    { $group: { _id: "$tickAt", burned: { $sum: "$burnedQty" }, shortfall: { $sum: "$shortfallQty" } } },
    { $sort: { _id: -1 } },
    { $limit: FULFILLMENT_WINDOW_TICKS },
  ]).toArray();
  const burnedTotal = recentTicks.reduce((s, t) => s + (t.burned ?? 0), 0);
  const shortfallTotal = recentTicks.reduce((s, t) => s + (t.shortfall ?? 0), 0);

  // 소모 자재 전체의 커버리지 판정 — 엔진의 서킷브레이커(criticalMaterialIds)와 같은 규칙.
  const consumedIds = new Set<string>();
  for (const { product } of ACTIVE_PRODUCTION_PRODUCTS) {
    for (const row of materialConsumptionFor(product)) consumedIds.add(row.materialId);
  }
  const [invDocs, matDocs] = await Promise.all([
    inventory.find({ materialId: { $in: [...consumedIds] } }).toArray(),
    materials.find({ _id: { $in: [...consumedIds] } }).toArray(),
  ]);
  // 자재의 대표 창고 = 재고가 가장 많은 문서 (engine.ts resolveWarehouse와 동일 규칙)
  const topInvByMaterial = new Map<string, (typeof invDocs)[number]>();
  for (const inv of invDocs) {
    const cur = topInvByMaterial.get(inv.materialId);
    if (!cur || inv.quantity > cur.quantity) topInvByMaterial.set(inv.materialId, inv);
  }
  const matById = new Map(matDocs.map((m) => [m._id, m]));

  const criticalMaterials: TickDiagnosisInput["criticalMaterials"] = [];
  for (const [materialId, inv] of topInvByMaterial) {
    const mat = matById.get(materialId);
    if (!mat) continue;
    const st = coverageState(inv.quantity, inv.avgDailyBurn ?? 0, mat.ropDays);
    if (st === "STOCKOUT" || st === "CRITICAL") {
      criticalMaterials.push({ materialId, code: mat.code, state: st });
    }
  }

  // 완제품 창고 중 CAPACITY_OVER인 것 — 마지막 스텝을 막고 있는 창고들
  const fgIds = new Set(finishedGoodsWarehouseIds());
  const capacityOverFinishedGoods = (await getWarehouseCapacity())
    .filter((wh) => fgIds.has(wh.id))
    .filter((wh) => warehouseVerdict({ code: wh.code, name: wh.name, utilization: wh.utilization, legalUtilization: wh.legalUtilization, capacityMode: wh.capacityMode }) === "CAPACITY_OVER")
    .map((wh) => ({ warehouseId: wh.id, utilization: wh.utilization }));

  // 차단된 WIP 규모 — 제품별 WIP 총량 중 결품 자재를 쓰는 스텝에 걸린 몫의 근사치.
  // 정확한 스텝별 집계는 tick이 twinTickEvents에 기록하게 되면 그 값으로 대체한다.
  let blockedLots = 0;
  if (criticalMaterials.length > 0) {
    const { waferLots, wipStepBuckets } = await collections();
    for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
      const cfg = getProductionConfig(fabId, product);
      if (!cfg) continue;
      if (cfg.wipMode === "PER_LOT") {
        blockedLots += await waferLots.countDocuments({ fabId, product, status: { $ne: "DONE" } });
      } else {
        const doc = await wipStepBuckets.findOne({ _id: `${fabId}__${product}` });
        blockedLots += doc ? doc.counts.reduce((s, c) => s + c, 0) : 0;
      }
    }
  }

  // 설계수요(3팹 합) — engine.ts의 getDesignDailyDemand와 같은 산식.
  const designDaily = new Map<string, number>();
  for (const { fabId, product } of ACTIVE_PRODUCTION_PRODUCTS) {
    const cfg = getProductionConfig(fabId, product);
    if (!cfg) continue;
    const dailyWaferStarts = cfg.waferStartsPerMonth / 30;
    for (const row of materialConsumptionFor(product)) {
      designDaily.set(row.materialId, (designDaily.get(row.materialId) ?? 0) + row.equivalentPerWafer * dailyWaferStarts);
    }
  }
  const starvedMaterials: { code: string; avgDailyBurn: number; designDaily: number }[] = [];
  for (const [materialId, inv] of topInvByMaterial) {
    const design = designDaily.get(materialId);
    const mat = matById.get(materialId);
    if (!design || design <= 0 || !mat) continue;
    const burn = inv.avgDailyBurn ?? 0;
    if (burn < design * EMA_STARVATION_RATIO) {
      starvedMaterials.push({ code: mat.code, avgDailyBurn: burn, designDaily: design });
    }
  }

  const diagnosis = diagnoseTick({
    now,
    engineStatus: state?.status === "RUNNING" ? "RUNNING" : "PAUSED",
    lastTickAt: state?.lastTickAt ?? null,
    lastOutputAt: lastOutput?.tickAt ?? null,
    burnedTotal,
    shortfallTotal,
    criticalMaterials,
    capacityOverFinishedGoods,
    pendingApprovalCount,
    inboundHoldCount,
    blockedLots,
    starvedMaterials,
  });

  return NextResponse.json({
    ...diagnosis,
    engineStatus: state?.status ?? "PAUSED",
    lastTickAt: state?.lastTickAt?.toISOString() ?? null,
    lastOutputAt: lastOutput?.tickAt?.toISOString() ?? null,
    secondsSinceTick: state?.lastTickAt ? Math.floor((now.getTime() - state.lastTickAt.getTime()) / 1000) : null,
    observedTicks: recentTicks.length,
    burnedTotal,
    shortfallTotal,
    starvedMaterials: starvedMaterials
      .sort((a, b) => a.avgDailyBurn / a.designDaily - b.avgDailyBurn / b.designDaily)
      .slice(0, 10),
  }, { headers: { "Cache-Control": "no-store" } });
}
