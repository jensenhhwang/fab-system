export const FAB_SCENARIO_VERSION = "FAB_MASTER_M20_V1" as const;

export const WAFERS_PER_FOUP = 25;

export const M20_PRODUCTION_SCENARIOS = {
  NORMAL: { waferStartsPerMonth: 117_000, utilization: 0.90, cycleTimeDays: 105 },
  UPLIFT: { waferStartsPerMonth: 123_500, utilization: 0.95, cycleTimeDays: 112 },
  NAMEPLATE: { waferStartsPerMonth: 130_000, utilization: 1.00, cycleTimeDays: 126 },
  EXPANSION: { waferStartsPerMonth: 143_000, utilization: 1.10, cycleTimeDays: 105 },
} as const;

export type M20ProductionScenarioId = keyof typeof M20_PRODUCTION_SCENARIOS;

// M20-HBM4-12H-V1 완제품 환산 가정. 실제 die map/수율이 아닌 planning baseline이다.
export const M20_HBM_OUTPUT_MODEL = {
  modelProduct: "M20-HBM4-12H-V1",
  grossDiesPerWafer: 765,
  knownGoodDiesPerWafer: 650,
  stackDieCount: 12,
  assemblyYield: 0.90,
} as const;

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
  // FAB_MASTER_M20_V1: 명목 130K, NORMAL 평균 운영 117K(90%). 실제 M20 내부 생산실적이 아닌 모델 기준.
  { id: "M20", name: "HBM Fab", product: "HBM", nominalWspm: 130_000, utilization: 0.90, waferYield: 0.85,
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

export function targetWipCount(waferStartsPerMonth: number, cycleTimeDays: number, wafersPerFoup = WAFERS_PER_FOUP): number {
  if (!Number.isFinite(waferStartsPerMonth) || waferStartsPerMonth < 0) throw new Error("월 wafer starts는 0 이상이어야 합니다.");
  if (!Number.isFinite(cycleTimeDays) || cycleTimeDays <= 0) throw new Error("cycle time은 0일보다 커야 합니다.");
  if (!Number.isFinite(wafersPerFoup) || wafersPerFoup <= 0) throw new Error("FOUP 적재량은 0보다 커야 합니다.");
  return Math.round((waferStartsPerMonth / 30) * cycleTimeDays / wafersPerFoup);
}

export function m20ProductionScenarioMetrics(scenarioId: M20ProductionScenarioId) {
  const scenario = M20_PRODUCTION_SCENARIOS[scenarioId];
  const referenceWip = targetWipCount(scenario.waferStartsPerMonth, M20_PRODUCTION_SCENARIOS.NORMAL.cycleTimeDays);
  const targetWip = targetWipCount(scenario.waferStartsPerMonth, scenario.cycleTimeDays);
  const finishedHbmStacksPerWafer = M20_HBM_OUTPUT_MODEL.knownGoodDiesPerWafer
    / M20_HBM_OUTPUT_MODEL.stackDieCount
    * M20_HBM_OUTPUT_MODEL.assemblyYield;
  return {
    ...scenario,
    scenarioId,
    dailyWaferStarts: scenario.waferStartsPerMonth / 30,
    dailyFoupStarts: scenario.waferStartsPerMonth / 30 / WAFERS_PER_FOUP,
    referenceWip,
    targetWip,
    demandMultiplier: scenario.waferStartsPerMonth / M20_PRODUCTION_SCENARIOS.NORMAL.waferStartsPerMonth,
    grossDiesPerWafer: M20_HBM_OUTPUT_MODEL.grossDiesPerWafer,
    knownGoodDiesPerWafer: M20_HBM_OUTPUT_MODEL.knownGoodDiesPerWafer,
    theoreticalStacksPerWafer: M20_HBM_OUTPUT_MODEL.knownGoodDiesPerWafer / M20_HBM_OUTPUT_MODEL.stackDieCount,
    finishedHbmStacksPerWafer,
    finishedHbmStacks: Math.round(scenario.waferStartsPerMonth * finishedHbmStacksPerWafer),
  };
}
