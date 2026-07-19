import { M20_PRODUCTION_SCENARIOS, type M20ProductionScenarioId } from "@/lib/fab-scenario";

export const M20_MATERIAL_CONSUMPTION_VERSION = "MATERIAL_CONSUMPTION_M20_V1" as const;
export const M20_MODEL_PRODUCT = "M20-HBM4-12H-V1" as const;

export type MaterialConsumptionBasis =
  | "WAFER_VISIT"
  | "TOOL_USAGE"
  | "REPLACEMENT_LIFE"
  | "STACK_EQUIVALENT";

export type M20MaterialConsumptionRow = {
  materialId: string;
  processCode: string;
  nativeBasis: MaterialConsumptionBasis;
  equivalentPerWafer: number;
  source: "LEGACY_DERIVED";
  confidence: "LOW";
  version: typeof M20_MATERIAL_CONSUMPTION_VERSION;
  modelProduct: typeof M20_MODEL_PRODUCT;
};

type BaselineInput = [materialId: string, processCode: string, normalMonthlyQty: number, nativeBasis: MaterialConsumptionBasis];

// 이전 FAB_SCENARIO의 M20 50K nameplate × 90% 가동률에서 processUsage가 작성됐다.
// 원단위는 이 45K wafer-start 기준에서 역산하고, 현 NORMAL 117K에 적용한다.
const LEGACY_REFERENCE_WAFER_STARTS = 45_000;

// docs/material-consumption-master.md의 M20 V1 표를 코드로 연결한다.
// legacyMonthlyQty는 이전 45K 기준값이며, 런타임 월소요량의 기준은 equivalentPerWafer다.
const M20_BASELINE_INPUTS: readonly BaselineInput[] = [
  ["GAS-001", "P01", 11_760, "TOOL_USAGE"],
  ["GAS-001", "P02", 14_700, "TOOL_USAGE"],
  ["GAS-001", "P03", 6_860, "TOOL_USAGE"],
  ["GAS-001", "P07", 5_880, "TOOL_USAGE"],
  ["GAS-001", "P08", 8_820, "TOOL_USAGE"],
  ["CHM-007", "P03", 595, "WAFER_VISIT"],
  ["CHM-009", "P03", 84, "WAFER_VISIT"],
  ["CHM-008", "P03", 434, "WAFER_VISIT"],
  ["CHM-001", "P04", 665, "WAFER_VISIT"],
  ["CHM-002", "P01", 1_015, "WAFER_VISIT"],
  ["CHM-002", "P04", 616, "WAFER_VISIT"],
  ["CSM-001", "P07", 1_995, "WAFER_VISIT"],
  ["CSM-002", "P07", 1_365, "WAFER_VISIT"],
  ["CSM-003", "P07", 1_176, "WAFER_VISIT"],
  ["CSM-004", "P07", 266, "REPLACEMENT_LIFE"],
  ["CSM-006", "P06", 14, "REPLACEMENT_LIFE"],
  ["CHM-011", "P08", 266, "WAFER_VISIT"],
  ["CSM-012", "P08", 126, "WAFER_VISIT"],
  ["CSM-009", "P09", 6, "REPLACEMENT_LIFE"],
  ["PKG-001", "P10", 2_940, "STACK_EQUIVALENT"],
  ["GAS-024", "P05", 126, "TOOL_USAGE"],
  ["CHM-013", "P07", 434, "WAFER_VISIT"],
  ["CSM-014", "P10", 245, "STACK_EQUIVALENT"],
  ["PKG-002", "P10", 1_260, "STACK_EQUIVALENT"],
  ["GAS-002", "P07", 1_610, "TOOL_USAGE"],
  ["GAS-003", "P06", 4_046, "TOOL_USAGE"],
  ["GAS-004", "P02", 630, "TOOL_USAGE"],
  ["GAS-006", "P02", 259, "TOOL_USAGE"],
  ["GAS-008", "P01", 2_800, "TOOL_USAGE"],
  ["GAS-009", "P03", 1_512, "TOOL_USAGE"],
  ["GAS-010", "P05", 329, "TOOL_USAGE"],
  ["GAS-011", "P04", 308, "TOOL_USAGE"],
  ["GAS-013", "P04", 203, "TOOL_USAGE"],
  ["GAS-014", "P02", 665, "TOOL_USAGE"],
  ["GAS-017", "P06", 238, "TOOL_USAGE"],
  ["GAS-018", "P07", 203, "TOOL_USAGE"],
  ["GAS-019", "P01", 56, "TOOL_USAGE"],
  ["GAS-020", "P04", 91, "TOOL_USAGE"],
  ["CHM-003", "P03", 1_323, "WAFER_VISIT"],
  ["CHM-004", "P03", 882, "WAFER_VISIT"],
  ["CHM-005", "P03", 735, "WAFER_VISIT"],
  ["CHM-010", "P03", 427, "WAFER_VISIT"],
  ["CSM-005", "P07", 105, "REPLACEMENT_LIFE"],
  ["CSM-007", "P06", 16.8, "REPLACEMENT_LIFE"],
  ["CSM-008", "P06", 14, "REPLACEMENT_LIFE"],
  ["CSM-011", "P03", 700, "WAFER_VISIT"],
  ["CSM-013", "P08", 511, "WAFER_VISIT"],
  ["CSM-015", "P04", 16.8, "REPLACEMENT_LIFE"],
] as const;

export const M20_MATERIAL_CONSUMPTION: readonly M20MaterialConsumptionRow[] = M20_BASELINE_INPUTS.map(
  ([materialId, processCode, legacyMonthlyQty, nativeBasis]) => ({
    materialId,
    processCode,
    nativeBasis,
    equivalentPerWafer: legacyMonthlyQty / LEGACY_REFERENCE_WAFER_STARTS,
    source: "LEGACY_DERIVED",
    confidence: "LOW",
    version: M20_MATERIAL_CONSUMPTION_VERSION,
    modelProduct: M20_MODEL_PRODUCT,
  }),
);

function roundDemand(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function m20ProcessUsageForScenario(scenarioId: M20ProductionScenarioId) {
  const scenario = M20_PRODUCTION_SCENARIOS[scenarioId];
  return M20_MATERIAL_CONSUMPTION.map((row) => ({
    _id: `${row.materialId}__${row.processCode}__HBM`,
    fabId: "M20" as const,
    product: "HBM" as const,
    materialId: row.materialId,
    processCode: row.processCode,
    monthlyQty: roundDemand(row.equivalentPerWafer * scenario.waferStartsPerMonth),
    equivalentPerWafer: row.equivalentPerWafer,
    consumptionBasis: row.nativeBasis,
    source: "MODELED_BASELINE" as const,
    sourceVersion: row.version,
    modelProduct: row.modelProduct,
  }));
}

export function m20MaterialDemandForScenario(scenarioId: M20ProductionScenarioId) {
  const rows = m20ProcessUsageForScenario(scenarioId);
  const result = new Map<string, { materialId: string; monthlyQty: number; equivalentPerWafer: number }>();
  for (const row of rows) {
    const current = result.get(row.materialId) ?? { materialId: row.materialId, monthlyQty: 0, equivalentPerWafer: 0 };
    current.monthlyQty += row.monthlyQty;
    current.equivalentPerWafer += row.equivalentPerWafer;
    result.set(row.materialId, current);
  }
  return [...result.values()].map((row) => ({
    ...row,
    monthlyQty: roundDemand(row.monthlyQty),
    equivalentPerWafer: roundDemand(row.equivalentPerWafer),
  }));
}
