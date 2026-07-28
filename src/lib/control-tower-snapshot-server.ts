import "server-only";

import { createHash } from "crypto";
import { collections } from "@/lib/db";
import { M20_MATERIAL_CONSUMPTION } from "@/lib/material-consumption";
import { runProcurementShadow } from "@/lib/procurement-agent-server";
import { getWarehouseCapacity } from "@/lib/queries";
import type {
  ControlTowerAIEpisodeDoc,
  ControlTowerEvidenceFact,
} from "@/lib/control-tower-live";

export type ControlTowerAISnapshot = ControlTowerAIEpisodeDoc["snapshot"];

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function coverageState(quantity: number, dailyBurn: number, ropDays: number) {
  if (quantity <= 0) return "STOCKOUT" as const;
  if (dailyBurn <= 0) return "NO_BURN" as const;
  const days = quantity / dailyBurn;
  if (days < Math.max(1, ropDays * 0.5)) return "CRITICAL" as const;
  if (days < ropDays) return "BELOW_ROP" as const;
  return "NORMAL" as const;
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
    workOrders,
    warehouseCapacity,
    wipCount,
    shadow,
  ] = await Promise.all([
    db.materials.find({ _id: { $in: materialIds } }).toArray(),
    db.inventory.find({ materialId: { $in: materialIds } }).toArray(),
    db.twinPurchaseOrders.find({ status: { $ne: "RECEIVED" } }).sort({ etaAt: 1 }).toArray(),
    db.workOrders.find({ status: { $in: ["QUEUED", "MATERIAL_WAIT", "RUNNING", "HOLD"] } })
      .project({ _id: 1, fabId: 1, processCode: 1, status: 1 })
      .toArray(),
    getWarehouseCapacity(),
    db.waferLots.countDocuments({
      fabId: "M20",
      product: "HBM",
      cohort: { $in: ["AGGREGATE", "MODELED_FOUP"] },
      status: "IN_PROGRESS",
    }),
    runProcurementShadow({}),
  ]);

  const materialById = new Map(materials.map((material) => [material._id, material]));
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

  const topRule = shadow.chains[0] ?? null;
  facts.push(
    {
      ref: "PROCUREMENT:SUMMARY",
      role: "PROCUREMENT",
      label: "구매 조치 대상",
      value: `조치 ${shadow.summary.actionable}종 · 발주 제안 ${shadow.summary.wouldPropose}종 · 보류 ${shadow.summary.blocked}종`,
      state: shadow.summary.blocked > 0
        ? "CRITICAL"
        : shadow.summary.actionable > 0 ? "ATTENTION" : "NORMAL",
    },
  );
  if (topRule) {
    facts.push({
      ref: `PROCUREMENT:RULE:${topRule.materialCode}`,
      role: "PROCUREMENT",
      label: `${topRule.materialName} 규칙 엔진 판정`,
      value: topRule.verdictText,
      state: topRule.verdict === "BLOCKED"
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

  const statusCounts = new Map<string, number>();
  for (const workOrder of workOrders) {
    statusCounts.set(String(workOrder.status), (statusCounts.get(String(workOrder.status)) ?? 0) + 1);
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
      ref: "PRODUCTION:WORK_ORDERS",
      role: "PRODUCTION",
      label: "작업지시 상태",
      value: `자재대기 ${statusCounts.get("MATERIAL_WAIT") ?? 0}건 · 대기 ${statusCounts.get("QUEUED") ?? 0}건 · 실행 ${statusCounts.get("RUNNING") ?? 0}건 · 보류 ${statusCounts.get("HOLD") ?? 0}건`,
      state: (statusCounts.get("MATERIAL_WAIT") ?? 0) > 0
        ? "CRITICAL"
        : (statusCounts.get("HOLD") ?? 0) > 0 ? "ATTENTION" : "NORMAL",
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

  const capturedAt = new Date().toISOString();
  const snapshot: ControlTowerAISnapshot = {
    capturedAt,
    facts,
    procurementRule: {
      scenarioLabel: shadow.scenarioLabel,
      actionable: shadow.summary.actionable,
      wouldAutoReceive: shadow.summary.wouldAutoReceive,
      wouldPropose: shadow.summary.wouldPropose,
      blocked: shadow.summary.blocked,
      topVerdict: topRule?.verdict ?? null,
      topVerdictText: topRule?.verdictText ?? null,
    },
  };

  const semanticInput = {
    materials: materialSignals.map((item) => [item.code, item.state]),
    workOrders: workOrders
      .map((item) => [String(item._id), String(item.status)])
      .sort((a, b) => a[0].localeCompare(b[0])),
    openPOs: openPOs.map((po) => [po._id, po.status]).sort((a, b) => a[0].localeCompare(b[0])),
    warehouses: warehouseCapacity
      .map((warehouse) => [
        warehouse.code,
        warehouseBand(Math.max(warehouse.utilization, warehouse.legalUtilization ?? 0)),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    procurement: {
      actionable: shadow.summary.actionable,
      wouldPropose: shadow.summary.wouldPropose,
      blocked: shadow.summary.blocked,
      topVerdict: topRule?.verdict ?? null,
      topMaterial: topRule?.materialCode ?? null,
    },
  };

  return {
    snapshot,
    snapshotHash: hashValue(snapshot),
    semanticHash: hashValue(semanticInput),
  };
}
