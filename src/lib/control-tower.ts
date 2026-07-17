import { WORKING_DAYS } from "@/lib/capacity";
import { FAB_SCENARIO, fabScenarioMetrics, type FabScenario } from "@/lib/fab-scenario";
import type { InventoryStatus, Product } from "@/lib/db";
import { PRODUCT_TO_FAB, type FabId } from "@/lib/fab-domain";

export type { FabId } from "@/lib/fab-domain";
export type CoverageStatus = "NORMAL" | "WARNING" | "RISK" | "CRITICAL" | "NO_DEMAND";

export type ControlTowerInventoryInput = {
  materialId: string;
  quantity: number;
  avgDailyUsage: number;
  status?: InventoryStatus;
  material: {
    code: string;
    name: string;
    unit: string;
    ropDays: number;
  };
};

export type ControlTowerUsageInput = {
  materialId: string;
  product: Product;
  monthlyQty: number;
};

export type FabMaterialCoverage = {
  fabId: FabId;
  dailyUsage: number;
  usageSharePct: number;
  plannedAllocation: number;
  coverageDays: number | null;
};

export type ControlTowerMaterial = {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  availableQuantity: number;
  excludedQuantity: number;
  dailyUsage: number;
  coverageDays: number | null;
  ropDays: number;
  status: CoverageStatus;
  usageSource: "PROCESS_PLAN" | "INVENTORY_FALLBACK" | "NO_DEMAND";
  fabs: FabMaterialCoverage[];
};

export type ControlTowerFab = {
  id: FabId;
  name: string;
  product: FabScenario["product"];
  color: string;
  nominalWspm: number;
  effectiveWspm: number;
  utilizationPct: number;
};

export type ControlTowerSnapshot = {
  version: string;
  calculatedAt: string;
  materials: ControlTowerMaterial[];
  fabs: ControlTowerFab[];
  summary: {
    materialCount: number;
    measuredCount: number;
    warningCount: number;
    criticalCount: number;
    minimumCoverageDays: number | null;
    minimumCoverageMaterialCode: string | null;
  };
};

const ACTIVE_INVENTORY = new Set<InventoryStatus | undefined>([undefined, "AVAILABLE"]);

function coverageStatus(coverageDays: number | null, ropDays: number): CoverageStatus {
  if (coverageDays === null) return "NO_DEMAND";
  if (coverageDays < 1) return "CRITICAL";
  if (coverageDays < 5) return "RISK";
  if (coverageDays < ropDays) return "WARNING";
  return "NORMAL";
}

function fallbackFabWeights() {
  const weighted = FAB_SCENARIO.map((fab) => ({
    fabId: fab.id,
    weight: fabScenarioMetrics(fab).dailyWaferStarts,
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  return weighted.map((item) => ({ fabId: item.fabId, share: item.weight / total }));
}

export function buildControlTowerSnapshot(
  inventories: readonly ControlTowerInventoryInput[],
  usages: readonly ControlTowerUsageInput[],
  calculatedAt = new Date(),
): ControlTowerSnapshot {
  const inventoryByMaterial = new Map<string, {
    code: string;
    name: string;
    unit: string;
    ropDays: number;
    available: number;
    excluded: number;
    fallbackDaily: number;
  }>();

  for (const inventory of inventories) {
    const current = inventoryByMaterial.get(inventory.materialId) ?? {
      code: inventory.material.code,
      name: inventory.material.name,
      unit: inventory.material.unit,
      ropDays: inventory.material.ropDays,
      available: 0,
      excluded: 0,
      fallbackDaily: 0,
    };
    if (ACTIVE_INVENTORY.has(inventory.status)) current.available += inventory.quantity;
    else current.excluded += inventory.quantity;
    // 동일 자재가 여러 물리 창고에 있어도 기존 fallback 수요를 중복 합산하지 않는다.
    current.fallbackDaily = Math.max(current.fallbackDaily, inventory.avgDailyUsage ?? 0);
    inventoryByMaterial.set(inventory.materialId, current);
  }

  const usageByMaterial = new Map<string, Record<FabId, number>>();
  for (const usage of usages) {
    const daily = Math.max(0, usage.monthlyQty) / WORKING_DAYS;
    const fabId = PRODUCT_TO_FAB[usage.product];
    const current = usageByMaterial.get(usage.materialId) ?? { M20: 0, M21: 0, M22: 0 };
    current[fabId] += daily;
    usageByMaterial.set(usage.materialId, current);
  }

  const fallbackWeights = fallbackFabWeights();
  const materials = [...inventoryByMaterial.entries()].map(([materialId, inventory]) => {
    const planned = usageByMaterial.get(materialId);
    const plannedTotal = planned ? planned.M20 + planned.M21 + planned.M22 : 0;
    const fallbackTotal = plannedTotal > 0 ? 0 : inventory.fallbackDaily;
    const dailyUsage = plannedTotal > 0 ? plannedTotal : fallbackTotal;
    const source: ControlTowerMaterial["usageSource"] = plannedTotal > 0
      ? "PROCESS_PLAN"
      : fallbackTotal > 0 ? "INVENTORY_FALLBACK" : "NO_DEMAND";
    const coverageDays = dailyUsage > 0 ? inventory.available / dailyUsage : null;

    const fabDaily = plannedTotal > 0
      ? (["M20", "M21", "M22"] as const).map((fabId) => ({ fabId, daily: planned?.[fabId] ?? 0 }))
      : fallbackWeights.map(({ fabId, share }) => ({ fabId, daily: fallbackTotal * share }));

    const fabs = fabDaily.map(({ fabId, daily }): FabMaterialCoverage => {
      const usageSharePct = dailyUsage > 0 ? daily / dailyUsage * 100 : 0;
      const plannedAllocation = inventory.available * usageSharePct / 100;
      return {
        fabId,
        dailyUsage: daily,
        usageSharePct,
        plannedAllocation,
        coverageDays: daily > 0 ? plannedAllocation / daily : null,
      };
    });

    return {
      materialId,
      code: inventory.code,
      name: inventory.name,
      unit: inventory.unit,
      availableQuantity: inventory.available,
      excludedQuantity: inventory.excluded,
      dailyUsage,
      coverageDays,
      ropDays: inventory.ropDays,
      status: coverageStatus(coverageDays, inventory.ropDays),
      usageSource: source,
      fabs,
    } satisfies ControlTowerMaterial;
  }).sort((a, b) => {
    if (a.coverageDays === null) return 1;
    if (b.coverageDays === null) return -1;
    return a.coverageDays - b.coverageDays;
  });

  const measured = materials.filter((material) => material.coverageDays !== null);
  const minimum = measured[0];
  return {
    version: "2026-PLAN-V1",
    calculatedAt: calculatedAt.toISOString(),
    materials,
    fabs: FAB_SCENARIO.map((fab) => ({
      id: fab.id,
      name: fab.name,
      product: fab.product,
      color: fab.color,
      nominalWspm: fab.nominalWspm,
      effectiveWspm: fabScenarioMetrics(fab).effectiveWspm,
      utilizationPct: fab.utilization * 100,
    })),
    summary: {
      materialCount: materials.length,
      measuredCount: measured.length,
      warningCount: measured.filter((material) => material.status !== "NORMAL").length,
      criticalCount: measured.filter((material) => material.status === "CRITICAL" || material.status === "RISK").length,
      minimumCoverageDays: minimum?.coverageDays ?? null,
      minimumCoverageMaterialCode: minimum?.code ?? null,
    },
  };
}
