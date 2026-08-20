import type { Filter } from "mongodb";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { collections, type Product, type WaferLotDoc } from "@/lib/db";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import { FOUP_WIP_BOOTSTRAP_VERSION } from "@/lib/foup-wip-model";
import { expandRouteMaster, getRouteMaster } from "@/lib/route-master";
import { getStepBucketCounts } from "@/lib/twin/step-bucket";
import { getOrInitTwinState } from "@/lib/twin/state";
import { computeBayLoads, type BayLoad } from "@/lib/process-bay-load";
import type { FabEquipmentMasterView } from "@/lib/fab-equipment-master-view";
import { buildM20FabEquipmentMaster } from "@/lib/m20-equipment-capacity-plan";
import { buildM21FabEquipmentMaster } from "@/lib/m21-equipment-capacity-plan";
import { buildM22FabEquipmentMaster } from "@/lib/m22-equipment-capacity-plan";
import { materialConsumptionFor } from "@/lib/material-consumption";
import { blockingMaterialIds, coverageState, type MaterialSignal } from "@/lib/materials-agent";
import { OPERATING_SPEED_MULTIPLIER } from "@/lib/twin/operating-clock";

export const dynamic = "force-dynamic";

const PRODUCTS: Product[] = ["HBM", "DRAM", "NAND"];
const FAB_PRODUCT: Record<FabId, Product> = { M20: "HBM", M21: "DRAM", M22: "NAND" };

type NodeCountRow = { _id: string | null; count: number; watchedCount: number };

const EQUIPMENT_MASTER_BY_FAB: Record<FabId, () => FabEquipmentMasterView> = {
  M20: buildM20FabEquipmentMaster,
  M21: buildM21FabEquipmentMaster,
  M22: buildM22FabEquipmentMaster,
};

// 계획(설비 마스터)과 실측(WIP·재고)을 processCode 하나의 축 위에 올린다.
async function buildBayLoads(
  fabId: FabId,
  product: Product,
  visits: { stepIndex: number; processCode: string }[],
  wipByStepIndex: Record<number, number>,
): Promise<BayLoad[]> {
  const master = EQUIPMENT_MASTER_BY_FAB[fabId]();
  const plannedLoadByProcess: Record<string, number | null> = {};
  const equipmentCountByProcess: Record<string, number> = {};
  for (const process of master.processes) {
    plannedLoadByProcess[process.processCode] = process.normalPlannedLoad;
    equipmentCountByProcess[process.processCode] = process.definedCount;
  }

  // 공정별 소모 자재와, 그중 지금 재고가 0인 것. 라인을 세우는 기준(STOCKOUT)은 이자재
  // 에이전트와 twin 엔진이 쓰는 것과 같은 함수를 써야 화면과 실제 게이팅이 어긋나지 않는다.
  const materialsByProcess: Record<string, string[]> = {};
  const consumptionRows = materialConsumptionFor(product);
  for (const row of consumptionRows) {
    const list = materialsByProcess[row.processCode] ?? [];
    if (!list.includes(row.materialId)) list.push(row.materialId);
    materialsByProcess[row.processCode] = list;
  }

  const materialIds = [...new Set(consumptionRows.map((row) => row.materialId))];
  const { inventory, materials } = await collections();
  const [invDocs, matDocs] = await Promise.all([
    inventory.find({ materialId: { $in: materialIds } }).toArray(),
    materials.find({ _id: { $in: materialIds } }).toArray(),
  ]);
  const matById = new Map(matDocs.map((m) => [m._id, m]));
  const bestInv = new Map<string, (typeof invDocs)[number]>();
  for (const doc of invDocs) {
    const prev = bestInv.get(doc.materialId);
    if (!prev || doc.quantity > prev.quantity) bestInv.set(doc.materialId, doc);
  }
  const signals: MaterialSignal[] = [];
  for (const materialId of materialIds) {
    const inv = bestInv.get(materialId);
    const mat = matById.get(materialId);
    if (!inv || !mat) continue;
    const dailyBurn = inv.avgDailyBurn ?? 0;
    signals.push({
      materialId, code: mat.code, name: mat.name, unit: mat.unit, ropDays: mat.ropDays,
      quantity: inv.quantity, dailyBurn,
      coverageDays: dailyBurn > 0 ? inv.quantity / dailyBurn : null,
      state: coverageState(inv.quantity, dailyBurn, mat.ropDays),
    });
  }

  return computeBayLoads({
    visits,
    wipByStepIndex,
    materialsByProcess,
    stockoutMaterialIds: blockingMaterialIds(signals),
    plannedLoadByProcess,
    equipmentCountByProcess,
  });
}

export async function GET(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.collaboration);
  if (access.error) return access.error;

  const fabId = req.nextUrl.searchParams.get("fabId") as FabId | null;
  const product = req.nextUrl.searchParams.get("product") as Product | null;
  if (!fabId || !FAB_IDS.includes(fabId)) {
    return NextResponse.json({ error: "fabId는 M20/M21/M22 중 하나여야 합니다." }, { status: 400 });
  }
  if (!product || !PRODUCTS.includes(product)) {
    return NextResponse.json({ error: "product는 HBM/DRAM/NAND 중 하나여야 합니다." }, { status: 400 });
  }
  if (FAB_PRODUCT[fabId] !== product) {
    return NextResponse.json({
      error: `${fabId}의 정본 제품은 ${FAB_PRODUCT[fabId]}입니다.`,
      expectedProduct: FAB_PRODUCT[fabId],
    }, { status: 409 });
  }

  try {
    const route = await getRouteMaster(fabId, product);
    if (!route) return NextResponse.json({ error: "route master를 찾을 수 없습니다." }, { status: 404 });

    const visits = expandRouteMaster(route);
    const stepRangeByNode = new Map<string, [number, number]>();
    for (const visit of visits) {
      const existing = stepRangeByNode.get(visit.nodeId);
      if (!existing) stepRangeByNode.set(visit.nodeId, [visit.stepIndex, visit.stepIndex]);
      else existing[1] = visit.stepIndex;
    }

    let wipConnection: "CONNECTED" | "NOT_CONNECTED" = fabId === "M20" ? "CONNECTED" : "NOT_CONNECTED";
    let unit: "LOT" | "FOUP_EQUIVALENT" = "LOT";
    let execution: {
      status: "RUNNING" | "PAUSED" | "HOLD";
      ownerName: string;
      lastRunAt: Date | null;
      lastMovedQuantity: number;
      lastCompletedQuantity: number;
      speedMultiplier: number;
      heartbeat: "LIVE" | "STALE" | "WAITING";
      source: "MODELED_BASELINE";
      holdReason: string | null;
    } | null = null;
    let total = 0;
    let watchedTotal = 0;
    let grouped: NodeCountRow[] = [];
    // bay(공정) 단위 부하 계산용 — 노드가 아니라 스텝 단위로 모아야 processCode로 되접을 수 있다.
    const wipByStepIndex: Record<number, number> = {};
    if (fabId === "M20") {
      const { waferLots } = await collections();
      const baseFilter: Filter<WaferLotDoc> = {
        fabId,
        product,
        status: "IN_PROGRESS",
        cohort: { $in: ["WATCHED", "MODELED_FOUP"] },
        bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
      };
      let stepRows: { _id: number; count: number }[] = [];
      [total, watchedTotal, grouped, stepRows] = await Promise.all([
        waferLots.countDocuments(baseFilter),
        waferLots.countDocuments({ ...baseFilter, cohort: "WATCHED" }),
        waferLots.aggregate<NodeCountRow>([
          { $match: baseFilter },
          { $group: {
            _id: "$currentNodeId",
            count: { $sum: 1 },
            watchedCount: { $sum: { $cond: [{ $eq: ["$cohort", "WATCHED"] }, 1, 0] } },
          } },
        ]).toArray(),
        waferLots.aggregate<{ _id: number; count: number }>([
          { $match: baseFilter },
          { $group: { _id: "$currentStepIndex", count: { $sum: 1 } } },
        ]).toArray(),
      ]);
      for (const row of stepRows) {
        if (row._id == null) continue;
        wipByStepIndex[row._id] = (wipByStepIndex[row._id] ?? 0) + row.count;
      }
    } else {
      // M21/M22는 twin 엔진이 진행시키는 step-bucket 원장(wipStepBuckets)을 그대로 읽는다.
      // 2026-08-12까지는 별도 원장(productionWipBuckets)을 읽고 있었는데, 그쪽은 자재 소모·완제품
      // 적립·출하와 연결돼 있지 않아 화면 숫자가 실제 생산과 달랐다(실측: M21 19,626 vs twin
      // 17,173). 자재를 태우고 완제품을 만드는 원장과 화면이 보는 원장은 같아야 한다.
      const bucket = await getStepBucketCounts(fabId, product);
      if (bucket) {
        wipConnection = "CONNECTED";
        unit = "FOUP_EQUIVALENT";
        const groupedByNode = new Map<string, number>();
        bucket.counts.forEach((quantity, stepIndex) => {
          if (!quantity) return;
          const nodeId = visits[stepIndex]?.nodeId;
          if (!nodeId) return;
          groupedByNode.set(nodeId, (groupedByNode.get(nodeId) ?? 0) + quantity);
          total += quantity;
          wipByStepIndex[stepIndex] = (wipByStepIndex[stepIndex] ?? 0) + quantity;
        });
        total = Math.round(total * 1_000_000) / 1_000_000;
        grouped = [...groupedByNode].map(([nodeId, count]) => ({ _id: nodeId, count, watchedCount: 0 }));

        const twinState = await getOrInitTwinState();
        execution = {
          status: twinState.status === "RUNNING" ? "RUNNING" : "PAUSED",
          ownerName: "최생산",
          lastRunAt: twinState.lastTickAt ?? null,
          lastMovedQuantity: 0,
          lastCompletedQuantity: 0,
          speedMultiplier: OPERATING_SPEED_MULTIPLIER,
          heartbeat: bucket.updatedAt
            ? Date.now() - bucket.updatedAt.getTime() <= twinState.tickIntervalMs * 12 ? "LIVE" : "STALE"
            : "WAITING",
          source: "MODELED_BASELINE",
          holdReason: null,
        };
      }
    }

    const countByNode = new Map(grouped.map((row) => [row._id, row]));
    const buckets = route.nodes.map((node, order) => {
      const row = countByNode.get(node.id);
      const count = row?.count ?? 0;
      return {
        nodeId: node.id,
        order,
        label: node.label,
        stage: node.stage,
        cycle: node.cycle,
        repeatCount: node.repeatCount,
        stepRange: stepRangeByNode.get(node.id) ?? [0, 0],
        count,
        watchedCount: row?.watchedCount ?? 0,
        percentOfTotal: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      };
    });

    // bay(공정) 부하 — 노드 단위 WIP을 스텝의 processCode로 되접어, 설비 카드의 계획 부하와
    // 같은 축에 올린다. 적체가 보이면 그 원인이 자재 결품인지 설비 부족인지까지 판정한다
    // (§lib/process-bay-load.ts). 두 카드가 서로 다른 축이라 대응이 안 되던 문제를 없앤다.
    const bayLoads = await buildBayLoads(fabId, product, visits, wipByStepIndex);

    return NextResponse.json({
      fabId,
      product,
      routeMasterId: route._id,
      routeVersion: route.version,
      routeSummary: { nodeCount: route.nodes.length, totalSteps: visits.length },
      wipConnection,
      unit,
      execution,
      asOf: new Date().toISOString(),
      total,
      summary: { watchedTotal, modeledTotal: total - watchedTotal },
      buckets,
      bayLoads,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "노드 밀도 집계 실패" }, { status: 409 });
  }
}
