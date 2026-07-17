import { buildControlTowerSnapshot } from "../src/lib/control-tower";
import { buildCampusMaterialFlowSnapshot } from "../src/lib/material-flow";

const inventory = [{
  materialId: "MAT-1", warehouseId: "MWH-01", quantity: 12_000, avgDailyUsage: 0, status: "AVAILABLE" as const,
  material: { code: "MAT-1", name: "대표 자재", unit: "kg", ropDays: 7, category: "CHM" },
  warehouse: { code: "MWH-01", name: "중앙 자동창고" },
}];
const usage = [
  { materialId: "MAT-1", product: "HBM" as const, processCode: "P03", monthlyQty: 60_000 },
  { materialId: "MAT-1", product: "DRAM" as const, processCode: "P03", monthlyQty: 30_000 },
  { materialId: "MAT-1", product: "NAND" as const, processCode: "P04", monthlyQty: 30_000 },
];
const tower = buildControlTowerSnapshot(inventory, usage, new Date("2026-07-17T00:00:00.000Z"));
const flow = buildCampusMaterialFlowSnapshot(
  tower,
  inventory,
  usage,
  [{ materialId: "MAT-1", availableQuantity: 12_000, qualityStatus: "AVAILABLE" }],
  [{ materialId: "MAT-1", quantity: 12_000, status: "AVAILABLE" }],
);

const material = flow.materials[0];
console.assert(flow.facilities.filter((facility) => facility.role === "FAB").length === 3, "Campus는 3FAB이어야 한다");
console.assert(material.consistency.status === "MATCHED", "Lot·HU·집계재고가 일치해야 한다");
console.assert(material.fabs.find((fab) => fab.fabId === "M20")?.processCodes.includes("P03"), "HBM 공정은 M20에 연결되어야 한다");
console.assert(material.fabs.find((fab) => fab.fabId === "M20")?.steps.some((step) => step.stage === "LINE_SIDE"), "M20 수직경로에 Line-side가 있어야 한다");
console.assert(material.fabs.find((fab) => fab.fabId === "M21")?.steps.length === 3, "M21은 이번 스프린트에서 요약 경로만 제공한다");
console.assert(flow.mode === "DERIVED_PLAN", "실제 할당 원장이 없을 때 LIVE로 표시하면 안 된다");

const liveFlow = buildCampusMaterialFlowSnapshot(
  tower,
  inventory,
  usage,
  [{ materialId: "MAT-1", availableQuantity: 12_000, qualityStatus: "AVAILABLE" }],
  [{ materialId: "MAT-1", quantity: 12_000, status: "AVAILABLE" }],
  [{ materialId: "MAT-1", fabId: "M20", quantity: 6_000, status: "RESERVED" }],
  [{ materialId: "MAT-1", fabId: "M20", type: "PICKED", quantity: 2_000 }],
);
const liveM20 = liveFlow.materials[0].fabs.find((fab) => fab.fabId === "M20")!;
console.assert(liveFlow.mode === "LIVE_LEDGER", "Allocation·Flow Event가 있으면 혼합 원장 장면으로 표시해야 한다");
console.assert(liveM20.plannedAllocation === 6_000, "M20 배분량은 실제 Allocation을 우선해야 한다");
console.assert(liveM20.steps.find((step) => step.stage === "PICKING")?.quantity === 2_000, "피킹 수량은 실제 Flow Event를 사용해야 한다");
console.assert(liveM20.steps.find((step) => step.stage === "PICKING")?.mode === "LIVE_LEDGER", "실제 피킹을 LIVE로 표시해야 한다");
console.log("✅ campus material flow rules passed");
