export const FAB_SCENARIO_VERSION = "2026-PLAN-V1" as const;

export type FabProduct = "HBM" | "DRAM" | "NAND";

export type FabScenario = {
  id: "M20" | "M21" | "M22";
  name: string;
  product: FabProduct;
  nominalWspm: number;
  utilization: number;
  waferYield: number;
  marketReferenceWspm: number;
  dimensionsM: { length: number; width: number; height: number };
  color: string;
};

export const GLOBAL_300MM_MEMORY_WSPM_2026 = 4_100_000;

export const FAB_SCENARIO: readonly FabScenario[] = [
  { id: "M20", name: "HBM Fab", product: "HBM", nominalWspm: 50_000, utilization: 0.90, waferYield: 0.85,
    marketReferenceWspm: 450_000, dimensionsM: { length: 330, width: 160, height: 105 }, color: "#EA002C" },
  { id: "M21", name: "DRAM Fab", product: "DRAM", nominalWspm: 80_000, utilization: 0.92, waferYield: 0.90,
    marketReferenceWspm: 1_550_000, dimensionsM: { length: 360, width: 180, height: 105 }, color: "#2563EB" },
  { id: "M22", name: "NAND Fab", product: "NAND", nominalWspm: 100_000, utilization: 0.90, waferYield: 0.88,
    marketReferenceWspm: 2_100_000, dimensionsM: { length: 400, width: 200, height: 105 }, color: "#7C3AED" },
] as const;

export function fabScenarioMetrics(fab: FabScenario) {
  const utilizedWspm = fab.nominalWspm * fab.utilization;
  const effectiveWspm = utilizedWspm * fab.waferYield;
  return {
    utilizedWspm,
    effectiveWspm,
    dailyWaferStarts: utilizedWspm / 30,
    waferEquivalentSharePct: effectiveWspm / fab.marketReferenceWspm * 100,
  };
}

// MODELED_BASELINE: 실측 MES 일일 생산량 마스터가 없어, FAB_SCENARIO 가동률로부터 역산한 계획치입니다.
export function dailyPlanKWafer(product: FabProduct): number {
  const fab = FAB_SCENARIO.find((entry) => entry.product === product);
  if (!fab) return 0;
  return fabScenarioMetrics(fab).dailyWaferStarts / 1000;
}

// MODELED_BASELINE: processUsage.monthlyQty가 가정한 월간 가동 웨이퍼 투입량(K wafer).
export function utilizedMonthlyKWafer(product: FabProduct): number {
  const fab = FAB_SCENARIO.find((entry) => entry.product === product);
  if (!fab) return 0;
  return (fab.nominalWspm * fab.utilization) / 1000;
}

export function campusScenarioMetrics(fabs: readonly FabScenario[] = FAB_SCENARIO) {
  const nominalWspm = fabs.reduce((sum, fab) => sum + fab.nominalWspm, 0);
  const effectiveWspm = fabs.reduce((sum, fab) => sum + fabScenarioMetrics(fab).effectiveWspm, 0);
  return {
    nominalWspm,
    effectiveWspm,
    globalMemorySharePct: effectiveWspm / GLOBAL_300MM_MEMORY_WSPM_2026 * 100,
  };
}
