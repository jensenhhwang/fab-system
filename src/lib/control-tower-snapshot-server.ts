import "server-only";

import { createHash } from "crypto";
import { collections } from "@/lib/db";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";
import { buildLiveProcurementShadow, type ProcurementLiveOrderSignal } from "@/lib/procurement-agent";
import { getWarehouseCapacity } from "@/lib/queries";
import { buildMaterialsShadow, coverageState, type MaterialSignal } from "@/lib/materials-agent";
import { buildAggregateProductionShadow } from "@/lib/production-agent";
import { buildLogisticsShadow, type WarehouseSignal } from "@/lib/logistics-agent";
import type {
  ControlTowerAIEpisodeDoc,
  ControlTowerEvidenceFact,
} from "@/lib/control-tower-live";

export type ControlTowerAISnapshot = ControlTowerAIEpisodeDoc["snapshot"];

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function warehouseBand(utilization: number) {
  if (utilization >= 100) return "FULL";
  if (utilization >= 90) return "OVER_90";
  if (utilization >= 80) return "OVER_80";
  return "NORMAL";
}

export async function buildControlTowerAISnapshot(): Promise<{
  snapshot: ControlTowerAISnapshot;
  snapshotHash: string;
  semanticHash: string;
}> {
  const db = await collections();
  const materialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((row) => row.materialId))];

  const [
    materials,
    inventories,
    openPOs,
    pendingOrHeldPOs,
    warehouseCapacity,
    wipCount,
    materialBlockedLotCount,
    finishedGoodsHoldLotCount,
  ] = await Promise.all([
    db.materials.find({ _id: { $in: materialIds } }).toArray(),
    db.inventory.find({ materialId: { $in: materialIds } }).toArray(),
    db.twinPurchaseOrders.find({ status: { $ne: "RECEIVED" } }).sort({ etaAt: 1 }).toArray(),
    // 김구매(PROCUREMENT) 카드가 실제 twin 상태를 서술하는 데 쓴다(가정법 없음, buildLiveProcurementShadow).
    db.twinPurchaseOrders.find({ status: { $in: ["PENDING_APPROVAL", "INBOUND_HOLD"] } }).toArray(),
    getWarehouseCapacity(),
    db.waferLots.countDocuments({
      fabId: "M20",
      product: "HBM",
      cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] },
      status: "IN_PROGRESS",
    }),
    // 최생산(PRODUCTION) 카드도 legacy workOrders(M20_PILOT, /mes 폐기 후 정지)가 아니라
    // advanceAggregateWip이 실제로 쓰는 라이브 신호(waferLots 집계)로 계산한다 — /api/twin/control-tower와
    // 같은 기준(K1)을 이 AI 스냅샷 경로에도 맞춘다.
    db.waferLots.countDocuments({ fabId: "M20", product: "HBM", materialBlockedAt: { $exists: true } }),
    db.waferLots.countDocuments({ fabId: "M20", product: "HBM", finishedGoodsHoldAt: { $exists: true } }),
  ]);

  const materialById = new Map(materials.map((material) => [material._id, material]));
  // pendingOrHeldPOs는 M20 소비 자재(materialIds) 밖의 자재를 참조할 수 있다(DRAM/NAND 전용 자재 등).
  const missingMaterialIds = [...new Set(pendingOrHeldPOs.map((po) => po.materialId))].filter((id) => !materialById.has(id));
  if (missingMaterialIds.length > 0) {
    for (const m of await db.materials.find({ _id: { $in: missingMaterialIds } }).toArray()) materialById.set(m._id, m);
  }
  const procurementSignals: ProcurementLiveOrderSignal[] = pendingOrHeldPOs.map((po) => ({
    materialId: po.materialId,
    materialCode: materialById.get(po.materialId)?.code ?? po.materialId,
    materialName: materialById.get(po.materialId)?.name ?? po.materialId,
    unit: materialById.get(po.materialId)?.unit ?? "",
    qty: po.qty,
    status: po.status as "PENDING_APPROVAL" | "INBOUND_HOLD",
    waitingMinutes: (Date.now() - po.orderedAt.getTime()) / 60_000,
    autonomyReason: po.autonomyReason ?? null,
  }));
  const inventoryByMaterial = new Map<string, { quantity: number; dailyBurn: number }>();
  for (const inventory of inventories) {
    const current = inventoryByMaterial.get(inventory.materialId) ?? { quantity: 0, dailyBurn: 0 };
    current.quantity += inventory.status === "HOLD" || inventory.status === "QUARANTINE"
      ? 0
      : inventory.quantity;
    current.dailyBurn = Math.max(current.dailyBurn, inventory.avgDailyBurn ?? 0);
    inventoryByMaterial.set(inventory.materialId, current);
  }

  const materialSignals = materialIds.map((materialId) => {
    const material = materialById.get(materialId);
    const inventory = inventoryByMaterial.get(materialId) ?? { quantity: 0, dailyBurn: 0 };
    const state = coverageState(inventory.quantity, inventory.dailyBurn, material?.ropDays ?? 0);
    const coverageDays = inventory.dailyBurn > 0 ? inventory.quantity / inventory.dailyBurn : null;
    return {
      materialId,
      code: material?.code ?? materialId,
      name: material?.name ?? materialId,
      unit: material?.unit ?? "",
      ropDays: material?.ropDays ?? 0,
      quantity: inventory.quantity,
      dailyBurn: inventory.dailyBurn,
      coverageDays,
      state,
    };
  }).sort((a, b) => {
    if (a.coverageDays === null) return 1;
    if (b.coverageDays === null) return -1;
    return a.coverageDays - b.coverageDays;
  });

  const facts: ControlTowerEvidenceFact[] = [];

  const capturedAt = new Date().toISOString();
  const procurementShadow = buildLiveProcurementShadow(procurementSignals, capturedAt);
  const topRule = procurementShadow.top;
  facts.push(
    {
      ref: "PROCUREMENT:SUMMARY",
      role: "PROCUREMENT",
      label: "구매 조치 대상",
      value: `승인 대기 ${procurementShadow.summary.pendingApproval}건 · 긴급 ${procurementShadow.summary.urgent}건 · 입고 보류 ${procurementShadow.summary.inboundHeld}건`,
      state: procurementShadow.summary.inboundHeld > 0 || procurementShadow.summary.urgent > 0
        ? "CRITICAL"
        : procurementShadow.summary.pendingApproval > 0 ? "ATTENTION" : "NORMAL",
    },
  );
  if (topRule) {
    facts.push({
      ref: `PROCUREMENT:RULE:${topRule.code}`,
      role: "PROCUREMENT",
      label: `${topRule.name} 규칙 엔진 판정`,
      value: topRule.verdictText,
      state: topRule.verdict === "INBOUND_HELD" || topRule.verdict === "APPROVAL_URGENT"
        ? "CRITICAL"
        : "ATTENTION",
    });
  }

  for (const item of materialSignals.filter((signal, index) => signal.state !== "NORMAL" || index < 5).slice(0, 12)) {
    facts.push({
      ref: `MATERIALS:${item.code}`,
      role: "MATERIALS",
      label: `${item.name} 가용 재고`,
      value: item.coverageDays === null
        ? `${Math.round(item.quantity).toLocaleString("ko-KR")}${item.unit} · 소모율 미확정`
        : `${Math.round(item.quantity).toLocaleString("ko-KR")}${item.unit} · 커버리지 ${item.coverageDays.toFixed(1)}일 · ROP ${item.ropDays}일`,
      state: item.state === "STOCKOUT" || item.state === "CRITICAL"
        ? "CRITICAL"
        : item.state === "BELOW_ROP" ? "ATTENTION" : "NORMAL",
    });
  }

  facts.push(
    {
      ref: "PRODUCTION:WIP",
      role: "PRODUCTION",
      label: "M20 진행 WIP",
      value: `${wipCount.toLocaleString("ko-KR")} FOUP`,
      state: "NORMAL",
    },
    {
      ref: "PRODUCTION:AGGREGATE_WIP",
      role: "PRODUCTION",
      label: "WIP 라이브 게이팅",
      value: `자재차단 ${materialBlockedLotCount.toLocaleString("ko-KR")}건 · 완제품창고차단 ${finishedGoodsHoldLotCount.toLocaleString("ko-KR")}건`,
      state: materialBlockedLotCount > 0
        ? "CRITICAL"
        : finishedGoodsHoldLotCount > 0 ? "ATTENTION" : "NORMAL",
    },
  );

  facts.push({
    ref: "LOGISTICS:OPEN_PO",
    role: "LOGISTICS",
    label: "Twin 입고 진행",
    value: `입고 중 ${openPOs.length}건 · 총 ${Math.round(openPOs.reduce((sum, po) => sum + po.qty, 0)).toLocaleString("ko-KR")}`,
    state: openPOs.length > 0 ? "ATTENTION" : "NORMAL",
  });
  for (const warehouse of warehouseCapacity
    .slice()
    .sort((a, b) => Math.max(b.utilization, b.legalUtilization ?? 0) - Math.max(a.utilization, a.legalUtilization ?? 0))
    .slice(0, 6)) {
    const highest = Math.max(warehouse.utilization, warehouse.legalUtilization ?? 0);
    facts.push({
      ref: `LOGISTICS:WH:${warehouse.code}`,
      role: "LOGISTICS",
      label: `${warehouse.name} 용량`,
      value: `공간 ${warehouse.utilization}%${warehouse.legalUtilization === null ? "" : ` · 법적 ${warehouse.legalUtilization}%`}`,
      state: highest >= 100 ? "CRITICAL" : highest >= 80 ? "ATTENTION" : "NORMAL",
    });
  }

  const materialsShadow = buildMaterialsShadow(
    materialSignals satisfies MaterialSignal[],
    capturedAt,
  );
  const productionShadow = buildAggregateProductionShadow(
    { fabId: "M20", inProgressCount: wipCount, materialBlockedCount: materialBlockedLotCount, finishedGoodsHoldCount: finishedGoodsHoldLotCount },
    capturedAt,
  );
  const warehouseSignals: WarehouseSignal[] = warehouseCapacity.map((wh) => ({
    code: wh.code, name: wh.name, utilization: wh.utilization, legalUtilization: wh.legalUtilization,
    capacityMode: wh.capacityMode,
  }));
  const logisticsShadow = buildLogisticsShadow(warehouseSignals, openPOs.length, capturedAt);

  const snapshot: ControlTowerAISnapshot = {
    capturedAt,
    facts,
    procurementRule: {
      scenarioLabel: procurementShadow.scenarioLabel,
      pendingApproval: procurementShadow.summary.pendingApproval,
      urgent: procurementShadow.summary.urgent,
      inboundHeld: procurementShadow.summary.inboundHeld,
      topVerdict: topRule?.verdict ?? null,
      topVerdictText: topRule?.verdictText ?? null,
    },
    materialsRule: {
      scenarioLabel: materialsShadow.scenarioLabel,
      critical: materialsShadow.summary.critical,
      watch: materialsShadow.summary.watch,
      dataGap: materialsShadow.summary.dataGap,
      topVerdict: materialsShadow.top?.verdict ?? null,
      topVerdictText: materialsShadow.top?.verdictText ?? null,
    },
    productionRule: {
      scenarioLabel: productionShadow.scenarioLabel,
      materialBlocked: productionShadow.summary.materialBlocked,
      hold: productionShadow.summary.hold,
      topVerdict: productionShadow.top?.verdict ?? null,
      topVerdictText: productionShadow.top?.verdictText ?? null,
    },
    logisticsRule: {
      scenarioLabel: logisticsShadow.scenarioLabel,
      over: logisticsShadow.summary.over,
      watch: logisticsShadow.summary.watch,
      openPOs: logisticsShadow.summary.openPOs,
      topVerdict: logisticsShadow.top?.verdict ?? null,
      topVerdictText: logisticsShadow.top?.verdictText ?? null,
    },
  };

  const semanticInput = {
    materials: materialSignals.map((item) => [item.code, item.state]),
    procurementOrders: pendingOrHeldPOs
      .map((po) => [po._id, po.status])
      .sort((a, b) => a[0].localeCompare(b[0])),
    openPOs: openPOs.map((po) => [po._id, po.status]).sort((a, b) => a[0].localeCompare(b[0])),
    warehouses: warehouseCapacity
      .map((warehouse) => [
        warehouse.code,
        warehouseBand(Math.max(warehouse.utilization, warehouse.legalUtilization ?? 0)),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    production: {
      materialBlockedLotCount,
      finishedGoodsHoldLotCount,
      wipCount,
    },
    procurement: {
      pendingApproval: procurementShadow.summary.pendingApproval,
      urgent: procurementShadow.summary.urgent,
      inboundHeld: procurementShadow.summary.inboundHeld,
      topVerdict: topRule?.verdict ?? null,
      topMaterial: topRule?.code ?? null,
    },
  };

  return {
    snapshot,
    snapshotHash: hashValue(snapshot),
    semanticHash: hashValue(semanticInput),
  };
}
