import type { AllocationStatus, InventoryStatus, MaterialFlowEventType, Product } from "@/lib/db";
import { FAB_IDS, PRODUCT_TO_FAB, type FabId, type FacilityRole } from "@/lib/fab-domain";
import type { ControlTowerSnapshot } from "@/lib/control-tower";

export const CAMPUS_LAYOUT_VERSION = "CAMPUS-2026-V1";

export type CampusFacility = {
  id: string;
  code: string;
  name: string;
  role: FacilityRole;
  fabId?: FabId;
  position: [number, number, number];
  color: string;
};

export const CAMPUS_FACILITIES: readonly CampusFacility[] = [
  { id: "WMS-CENTRAL", code: "WMS", name: "Central Material WMS", role: "CENTRAL_WMS", position: [0, 0, -9], color: "#2D2A27" },
  { id: "FAB-M20", code: "M20", name: "HBM Fab", role: "FAB", fabId: "M20", position: [-10, 0, 7], color: "#EA002C" },
  { id: "FAB-M21", code: "M21", name: "DRAM Fab", role: "FAB", fabId: "M21", position: [0, 0, 7], color: "#2563EB" },
  { id: "FAB-M22", code: "M22", name: "NAND Fab", role: "FAB", fabId: "M22", position: [10, 0, 7], color: "#7C3AED" },
  { id: "M20-PRS", code: "M20-PRS", name: "M20 Process Supply", role: "PRS", fabId: "M20", position: [-8, 0, 3.5], color: "#EA002C" },
  { id: "M20-LS", code: "M20-LS", name: "M20 Line-side", role: "LINE_SIDE", fabId: "M20", position: [-9, 0, 5.2], color: "#EA002C" },
] as const;

export type FlowDataMode = "LIVE_LEDGER" | "DERIVED_PLAN";
export type FlowStage = "WMS_STOCK" | "ALLOCATION" | "PICKING" | "STAGING" | "TRANSFER" | "PRS" | "LINE_SIDE" | "CONSUMPTION" | "RETURN";
export type FlowStepStatus = "AVAILABLE" | "PLANNED" | "BLOCKED" | "NOT_CONNECTED";

export type MaterialFlowStep = {
  id: string;
  stage: FlowStage;
  label: string;
  facilityId: string;
  quantity: number;
  status: FlowStepStatus;
  mode: FlowDataMode;
};

export type MaterialFlowFab = {
  fabId: FabId;
  dailyUsage: number;
  usageSharePct: number;
  plannedAllocation: number;
  coverageDays: number | null;
  processCodes: string[];
  steps: MaterialFlowStep[];
};

export type LedgerConsistency = {
  aggregateInventory: number;
  availableLots: number | null;
  handlingUnits: number | null;
  status: "MATCHED" | "MISMATCH" | "NOT_AVAILABLE";
};

export type CampusMaterialFlow = {
  materialId: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  availableQuantity: number;
  excludedQuantity: number;
  coverageDays: number | null;
  sourceLocations: { facilityId: string; name: string; quantity: number }[];
  fabs: MaterialFlowFab[];
  consistency: LedgerConsistency;
};

export type CampusMaterialFlowSnapshot = {
  layoutVersion: string;
  mode: FlowDataMode;
  modeReason: string;
  calculatedAt: string;
  facilities: CampusFacility[];
  materials: CampusMaterialFlow[];
};

export type CampusInventoryInput = {
  materialId: string;
  warehouseId: string;
  quantity: number;
  status?: InventoryStatus;
  warehouse: { code: string; name: string };
  material: { category: string };
};

export type CampusUsageInput = {
  materialId: string;
  product: Product;
  processCode: string;
};

export type CampusLotInput = {
  materialId: string;
  availableQuantity: number;
  qualityStatus: InventoryStatus;
};

export type CampusHandlingUnitInput = {
  materialId: string;
  quantity: number;
  status: InventoryStatus;
};

export type CampusAllocationInput = {
  materialId: string;
  fabId: FabId;
  quantity: number;
  status: AllocationStatus;
};

export type CampusFlowEventInput = {
  materialId: string;
  fabId: FabId;
  type: MaterialFlowEventType;
  quantity: number;
};

const ACTIVE = new Set<InventoryStatus | undefined>([undefined, "AVAILABLE"]);

function consistencyFor(
  aggregateInventory: number,
  lots: readonly CampusLotInput[],
  handlingUnits: readonly CampusHandlingUnitInput[],
): LedgerConsistency {
  const materialLots = lots.filter((lot) => lot.qualityStatus === "AVAILABLE");
  const materialUnits = handlingUnits.filter((unit) => unit.status === "AVAILABLE");
  const availableLots = materialLots.length
    ? materialLots.reduce((sum, lot) => sum + lot.availableQuantity, 0)
    : null;
  const unitQuantity = materialUnits.length
    ? materialUnits.reduce((sum, unit) => sum + unit.quantity, 0)
    : null;
  if (availableLots === null || unitQuantity === null) {
    return { aggregateInventory, availableLots, handlingUnits: unitQuantity, status: "NOT_AVAILABLE" };
  }
  const matches = Math.abs(aggregateInventory - availableLots) < 1e-6
    && Math.abs(aggregateInventory - unitQuantity) < 1e-6;
  return { aggregateInventory, availableLots, handlingUnits: unitQuantity, status: matches ? "MATCHED" : "MISMATCH" };
}

function flowSteps(
  fabId: FabId,
  stockQuantity: number,
  plannedQuantity: number,
  dailyUsage: number,
  hasStock: boolean,
  liveAllocationQuantity: number | null,
  eventQuantities: Readonly<Partial<Record<MaterialFlowEventType, number>>>,
): MaterialFlowStep[] {
  const isM20 = fabId === "M20";
  const baseStatus: FlowStepStatus = hasStock ? "PLANNED" : "BLOCKED";
  const allocationQuantity = liveAllocationQuantity ?? plannedQuantity;
  const common: MaterialFlowStep[] = [
    { id: `${fabId}-stock`, stage: "WMS_STOCK", label: "WMS 가용재고", facilityId: "WMS-CENTRAL", quantity: stockQuantity, status: hasStock ? "AVAILABLE" : "BLOCKED", mode: "LIVE_LEDGER" },
    { id: `${fabId}-allocation`, stage: "ALLOCATION", label: `${fabId} 계획배분`, facilityId: "WMS-CENTRAL", quantity: allocationQuantity, status: baseStatus, mode: liveAllocationQuantity === null ? "DERIVED_PLAN" : "LIVE_LEDGER" },
    { id: `${fabId}-transfer`, stage: "TRANSFER", label: `${fabId} 공급예정`, facilityId: `FAB-${fabId}`, quantity: allocationQuantity, status: baseStatus, mode: "DERIVED_PLAN" },
  ];
  if (!isM20) return common;
  const operationalStep = (type: MaterialFlowEventType, fallback: number) => ({
    quantity: eventQuantities[type] ?? fallback,
    status: eventQuantities[type] ? "AVAILABLE" as const : baseStatus,
    mode: eventQuantities[type] ? "LIVE_LEDGER" as const : "DERIVED_PLAN" as const,
  });
  return [
    common[0],
    common[1],
    { id: "M20-picking", stage: "PICKING", label: "피킹", facilityId: "WMS-CENTRAL", ...operationalStep("PICKED", allocationQuantity) },
    { id: "M20-staging", stage: "STAGING", label: "M20 Staging", facilityId: "WMS-CENTRAL", ...operationalStep("STAGED", allocationQuantity) },
    common[2],
    { id: "M20-prs", stage: "PRS", label: "M20 PRS", facilityId: "M20-PRS", ...operationalStep("RECEIVED", allocationQuantity) },
    { id: "M20-line", stage: "LINE_SIDE", label: "Line-side", facilityId: "M20-LS", ...operationalStep("LINE_SIDE", dailyUsage) },
    { id: "M20-consume", stage: "CONSUMPTION", label: "MES 일소비", facilityId: "FAB-M20", ...operationalStep("CONSUMED", dailyUsage) },
    { id: "M20-return", stage: "RETURN", label: "잔량 회수", facilityId: "WMS-CENTRAL", ...(eventQuantities.RETURNED ? operationalStep("RETURNED", 0) : { quantity: 0, status: "NOT_CONNECTED" as const, mode: "DERIVED_PLAN" as const }) },
  ];
}

export function buildCampusMaterialFlowSnapshot(
  controlTower: ControlTowerSnapshot,
  inventories: readonly CampusInventoryInput[],
  usages: readonly CampusUsageInput[],
  lots: readonly CampusLotInput[],
  handlingUnits: readonly CampusHandlingUnitInput[],
  allocations: readonly CampusAllocationInput[] = [],
  events: readonly CampusFlowEventInput[] = [],
): CampusMaterialFlowSnapshot {
  const materials = controlTower.materials.map((material): CampusMaterialFlow => {
    const inventoryRows = inventories.filter((row) => row.materialId === material.materialId);
    const sourceMap = new Map<string, { facilityId: string; name: string; quantity: number }>();
    for (const row of inventoryRows) {
      if (!ACTIVE.has(row.status)) continue;
      const current = sourceMap.get(row.warehouse.code) ?? {
        facilityId: row.warehouse.code,
        name: row.warehouse.name,
        quantity: 0,
      };
      current.quantity += row.quantity;
      sourceMap.set(row.warehouse.code, current);
    }
    const category = inventoryRows[0]?.material.category ?? "UNKNOWN";
    const materialLots = lots.filter((lot) => lot.materialId === material.materialId);
    const materialUnits = handlingUnits.filter((unit) => unit.materialId === material.materialId);
    const fabs = FAB_IDS.map((fabId): MaterialFlowFab => {
      const coverage = material.fabs.find((item) => item.fabId === fabId)!;
      const liveAllocations = allocations.filter((allocation) => (
        allocation.materialId === material.materialId
        && allocation.fabId === fabId
        && allocation.status !== "CANCELLED"
      ));
      const liveAllocationQuantity = liveAllocations.length
        ? liveAllocations.reduce((sum, allocation) => sum + allocation.quantity, 0)
        : null;
      const eventQuantities = events
        .filter((event) => event.materialId === material.materialId && event.fabId === fabId)
        .reduce<Partial<Record<MaterialFlowEventType, number>>>((totals, event) => {
          totals[event.type] = (totals[event.type] ?? 0) + event.quantity;
          return totals;
        }, {});
      const processCodes = [...new Set(usages
        .filter((usage) => usage.materialId === material.materialId && PRODUCT_TO_FAB[usage.product] === fabId)
        .map((usage) => usage.processCode))];
      return {
        fabId,
        dailyUsage: coverage.dailyUsage,
        usageSharePct: coverage.usageSharePct,
        plannedAllocation: liveAllocationQuantity ?? coverage.plannedAllocation,
        coverageDays: coverage.coverageDays,
        processCodes,
        steps: flowSteps(fabId, material.availableQuantity, coverage.plannedAllocation, coverage.dailyUsage, material.availableQuantity > 0, liveAllocationQuantity, eventQuantities),
      };
    });
    return {
      materialId: material.materialId,
      code: material.code,
      name: material.name,
      category,
      unit: material.unit,
      availableQuantity: material.availableQuantity,
      excludedQuantity: material.excludedQuantity,
      coverageDays: material.coverageDays,
      sourceLocations: [...sourceMap.values()].sort((a, b) => b.quantity - a.quantity),
      fabs,
      consistency: consistencyFor(material.availableQuantity, materialLots, materialUnits),
    };
  });

  return {
    layoutVersion: CAMPUS_LAYOUT_VERSION,
    mode: allocations.length || events.length ? "LIVE_LEDGER" : "DERIVED_PLAN",
    modeReason: allocations.length || events.length
      ? "MES Allocation·피킹 이벤트는 실제 원장을 사용하고, 아직 이벤트가 없는 이송·Line-side 단계는 계획값으로 표시합니다."
      : "Fab별 Allocation·TransferOrder 운영 원장이 아직 없어 현재 공정계획 사용비중으로 배분한 계획 장면입니다.",
    calculatedAt: controlTower.calculatedAt,
    facilities: CAMPUS_FACILITIES.map((facility) => ({ ...facility })),
    materials,
  };
}
