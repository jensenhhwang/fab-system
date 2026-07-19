import { M20_PRODUCTION_SCENARIOS, type M20ProductionScenarioId } from "@/lib/fab-scenario";

export const FAB_EQUIPMENT_MASTER_VERSION = "FAB_EQUIPMENT_MASTER_M20_V3" as const;
export const M20_EQUIPMENT_DEFINITION_STATUS = "INDUSTRY_RANGE_INFORMED_MODELED_BASELINE" as const;
export const M20_EQUIPMENT_RATE_UNIT = "MIXED_NATIVE_CAPACITY" as const;
export const M20_NORMAL_MAX_PLANNED_LOAD = 0.85;

const HOURS_PER_DAY = 24;
const DAYS_PER_MONTH = 30;

export type AssessedProcessCode = "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P07" | "P08" | "P09" | "P10";
export type M20ProcessCode = AssessedProcessCode;
type WphAssessedProcessCode = Exclude<AssessedProcessCode, "P10">;

export type M20BackendCapacityUnit = "WAFER_HOUR" | "KGD_HOUR" | "DIE_PLACEMENT_HOUR" | "STACK_HOUR";
export type M20BackendCapacityStageCode = "DICING" | "DIE_SORT" | "DIE_BONDING" | "MOLDING" | "FINAL_TEST";
export const M20_BACKEND_MODELED_OEE = 0.855;
export const M20_KGD_PER_WAFER = 650;
export const M20_DRAM_DIES_PER_STACK = 12;
export const M20_ASSEMBLY_YIELD = 0.9;
export const M20_BACKEND_CAPACITY_STAGES = Object.freeze([
  { processCode: "P10", stageCode: "DICING", name: "Dicing / Singulation", equipmentCount: 6, ratedRate: 38, capacityUnit: "WAFER_HOUR", driverPerWafer: 1 },
  { processCode: "P10", stageCode: "DIE_SORT", name: "Die Sort / KGD", equipmentCount: 6, ratedRate: 25_000, capacityUnit: "KGD_HOUR", driverPerWafer: M20_KGD_PER_WAFER },
  { processCode: "P10", stageCode: "DIE_BONDING", name: "12-Hi DRAM Bonding", equipmentCount: 16, ratedRate: 9_200, capacityUnit: "DIE_PLACEMENT_HOUR", driverPerWafer: M20_KGD_PER_WAFER },
  { processCode: "P10", stageCode: "MOLDING", name: "MUF / Molding / Cure", equipmentCount: 4, ratedRate: 3_100, capacityUnit: "STACK_HOUR", driverPerWafer: M20_KGD_PER_WAFER / M20_DRAM_DIES_PER_STACK },
  { processCode: "P10", stageCode: "FINAL_TEST", name: "Final Test", equipmentCount: 4, ratedRate: 3_100, capacityUnit: "STACK_HOUR", driverPerWafer: M20_KGD_PER_WAFER / M20_DRAM_DIES_PER_STACK },
] as const satisfies ReadonlyArray<{
  processCode: "P10";
  stageCode: M20BackendCapacityStageCode;
  name: string;
  equipmentCount: number;
  ratedRate: number;
  capacityUnit: M20BackendCapacityUnit;
  driverPerWafer: number;
}>);

export const M20_MODELED_RATE_VALUES: Readonly<Record<M20ProcessCode, number>> = Object.freeze({
  P01: 115, P02: 105, P03: 92, P04: 108, P05: 120,
  P06: 105, P07: 98, P08: 86, P09: 130, P10: 140,
});

type AssessedProcessAssumption = {
  processCode: WphAssessedProcessCode;
  name: string;
  previousCount: number;
  ratedWph: number;
  capacityPassesPerWafer: number;
  assessment: "WPH_PROXY";
};

type NativeStageProcessAssumption = {
  processCode: "P10";
  name: string;
  previousCount: number;
  ratedWph: null;
  capacityPassesPerWafer: null;
  assessment: "NATIVE_STAGE_PROXY";
};

type ProcessAssumption = AssessedProcessAssumption | NativeStageProcessAssumption;

const PROCESS_ASSUMPTIONS: readonly ProcessAssumption[] = [
  { processCode: "P01", name: "산화", previousCount: 32, ratedWph: M20_MODELED_RATE_VALUES.P01, capacityPassesPerWafer: 4, assessment: "WPH_PROXY" },
  { processCode: "P02", name: "CVD", previousCount: 48, ratedWph: M20_MODELED_RATE_VALUES.P02, capacityPassesPerWafer: 27, assessment: "WPH_PROXY" },
  { processCode: "P03", name: "포토", previousCount: 64, ratedWph: M20_MODELED_RATE_VALUES.P03, capacityPassesPerWafer: 27, assessment: "WPH_PROXY" },
  { processCode: "P04", name: "식각", previousCount: 72, ratedWph: M20_MODELED_RATE_VALUES.P04, capacityPassesPerWafer: 27, assessment: "WPH_PROXY" },
  { processCode: "P05", name: "이온주입", previousCount: 24, ratedWph: M20_MODELED_RATE_VALUES.P05, capacityPassesPerWafer: 6, assessment: "WPH_PROXY" },
  { processCode: "P06", name: "금속배선", previousCount: 48, ratedWph: M20_MODELED_RATE_VALUES.P06, capacityPassesPerWafer: 5, assessment: "WPH_PROXY" },
  { processCode: "P07", name: "CMP", previousCount: 32, ratedWph: M20_MODELED_RATE_VALUES.P07, capacityPassesPerWafer: 27, assessment: "WPH_PROXY" },
  { processCode: "P08", name: "TSV·박막화", previousCount: 56, ratedWph: M20_MODELED_RATE_VALUES.P08, capacityPassesPerWafer: 4, assessment: "WPH_PROXY" },
  { processCode: "P09", name: "웨이퍼 테스트", previousCount: 40, ratedWph: M20_MODELED_RATE_VALUES.P09, capacityPassesPerWafer: 2, assessment: "WPH_PROXY" },
  { processCode: "P10", name: "패키징", previousCount: 36, ratedWph: null, capacityPassesPerWafer: null, assessment: "NATIVE_STAGE_PROXY" },
] as const;

export type M20EquipmentScenarioGate = {
  scenarioId: M20ProductionScenarioId;
  waferStartsPerMonth: number;
  bottleneckProcessCode: AssessedProcessCode;
  bottleneckUtilization: number;
  reservedHeadroom: number;
  status: "NORMAL_WITH_RESERVE" | "UPLIFT_WITH_REDUCED_RESERVE" | "NAMEPLATE_STRESS" | "OVER_CAPACITY";
};

export type M20FabEquipmentMaster = {
  version: typeof FAB_EQUIPMENT_MASTER_VERSION;
  status: typeof M20_EQUIPMENT_DEFINITION_STATUS;
  rateUnit: typeof M20_EQUIPMENT_RATE_UNIT;
  fabDefinitions: Array<{
    fabId: "M20" | "M21" | "M22";
    product: "HBM4 12-Hi 36GB" | "TBD";
    referenceWspm: number | null;
    targetReservedHeadroom: number | null;
    totalEquipment: number | null;
    status: "INDUSTRY_RANGE_INFORMED_MODELED_BASELINE" | "NOT_MODELED";
  }>;
  headroomPolicy: {
    referenceScenario: "NORMAL";
    maxPlannedLoad: number;
    minimumReservedHeadroom: number;
    minimumSupportedWspm: number;
  };
  p10OutputContract: {
    kgdPerWafer: number;
    dramDiesPerStack: number;
    assemblyYield: number;
    grossStacksPerDay: number;
    goodStacksPerDay: number;
    goodStacksPerMonth: number;
    baseDiePlacementIncluded: false;
    baseDieCapacityStatus: "CAPACITY_PENDING";
    baseDieConsumptionPerGrossStack: 1;
  };
  previousBaselineTotal: number;
  totalEquipment: number;
  totalGap: number;
  supportedWspm: number;
  bottleneckProcessCode: AssessedProcessCode;
  normalPlannedLoad: number;
  normalReservedHeadroom: number;
  processes: Array<{
    processCode: M20ProcessCode;
    name: string;
    assessment: ProcessAssumption["assessment"];
    previousCount: number;
    definedCount: number;
    gap: number;
    ratedWph: number | null;
    capacityPassesPerWafer: number | null;
    supportedWspm: number;
    normalPlannedLoad: number;
    bottleneckCapacityStage: M20BackendCapacityStageCode | null;
    capacityStages: Array<{
      stageCode: M20BackendCapacityStageCode;
      name: string;
      equipmentCount: number;
      ratedRate: number;
      capacityUnit: M20BackendCapacityUnit;
      modeledOee: number;
      normalDemandPerDay: number;
      effectiveCapacityPerDay: number;
      normalPlannedLoad: number;
    }>;
  }>;
  scenarioGates: M20EquipmentScenarioGate[];
  notes: string[];
};

// migrate-m20-pilot.ts의 MODELED_BASELINE OEE 생성 규칙과 동일하다.
export function modeledOeeForSequence(sequence: number): number {
  if (!Number.isInteger(sequence) || sequence <= 0) throw new Error("장비 sequence는 양의 정수여야 합니다.");
  return Math.round((0.82 + (sequence % 8) * 0.01) * 100) / 100;
}

function supportedWspm(process: AssessedProcessAssumption, count: number): number {
  let effectiveWph = 0;
  for (let sequence = 1; sequence <= count; sequence += 1) {
    effectiveWph += process.ratedWph * modeledOeeForSequence(sequence);
  }
  return effectiveWph * HOURS_PER_DAY / process.capacityPassesPerWafer * DAYS_PER_MONTH;
}

function backendCapacityStages(processCode: "P10", targetWspm: number) {
  const wafersPerDay = targetWspm / DAYS_PER_MONTH;
  return M20_BACKEND_CAPACITY_STAGES.filter((stage) => stage.processCode === processCode).map((stage) => {
    const demandPerDay = wafersPerDay * stage.driverPerWafer;
    const effectiveCapacityPerDay = stage.equipmentCount * stage.ratedRate * HOURS_PER_DAY * M20_BACKEND_MODELED_OEE;
    return {
      stageCode: stage.stageCode,
      name: stage.name,
      equipmentCount: stage.equipmentCount,
      ratedRate: stage.ratedRate,
      capacityUnit: stage.capacityUnit,
      modeledOee: M20_BACKEND_MODELED_OEE,
      normalDemandPerDay: demandPerDay,
      effectiveCapacityPerDay,
      normalPlannedLoad: demandPerDay / effectiveCapacityPerDay,
      supportedWspm: effectiveCapacityPerDay / stage.driverPerWafer * DAYS_PER_MONTH,
    };
  });
}

function backendSupportedWspm(processCode: "P10"): number {
  return Math.min(...backendCapacityStages(processCode, M20_PRODUCTION_SCENARIOS.NORMAL.waferStartsPerMonth).map((stage) => stage.supportedWspm));
}

function processSupportedWspm(process: ProcessAssumption, count: number): number {
  return process.assessment === "WPH_PROXY" ? supportedWspm(process, count) : backendSupportedWspm(process.processCode);
}

function definedCount(process: ProcessAssumption): number {
  if (process.assessment !== "WPH_PROXY") return process.previousCount;
  const normalWspm = M20_PRODUCTION_SCENARIOS.NORMAL.waferStartsPerMonth;
  let count = process.previousCount;
  while (normalWspm / supportedWspm(process, count) > M20_NORMAL_MAX_PLANNED_LOAD) count += 1;
  return count;
}

export const M20_DEFINED_EQUIPMENT_COUNTS = Object.freeze(Object.fromEntries(
  PROCESS_ASSUMPTIONS.map((process) => [process.processCode, definedCount(process)]),
)) as Readonly<Record<M20ProcessCode, number>>;

function assessedMasterMetrics(targetWspm: number) {
  const rows = PROCESS_ASSUMPTIONS.map((process) => ({
    processCode: process.processCode,
    supportedWspm: processSupportedWspm(process, M20_DEFINED_EQUIPMENT_COUNTS[process.processCode]),
  }));
  const bottleneck = rows.reduce((minimum, row) => row.supportedWspm < minimum.supportedWspm ? row : minimum);
  return {
    supportedWspm: bottleneck.supportedWspm,
    bottleneckProcessCode: bottleneck.processCode,
    plannedLoad: targetWspm / bottleneck.supportedWspm,
  };
}

function scenarioStatus(scenarioId: M20ProductionScenarioId, utilization: number): M20EquipmentScenarioGate["status"] {
  if (utilization > 1) return "OVER_CAPACITY";
  if (scenarioId === "NORMAL") return "NORMAL_WITH_RESERVE";
  if (scenarioId === "UPLIFT") return "UPLIFT_WITH_REDUCED_RESERVE";
  return "NAMEPLATE_STRESS";
}

export function buildM20FabEquipmentMaster(): M20FabEquipmentMaster {
  const normalWspm = M20_PRODUCTION_SCENARIOS.NORMAL.waferStartsPerMonth;
  const previousBaselineTotal = PROCESS_ASSUMPTIONS.reduce((sum, process) => sum + process.previousCount, 0);
  const totalEquipment = Object.values(M20_DEFINED_EQUIPMENT_COUNTS).reduce((sum, count) => sum + count, 0);
  const masterMetrics = assessedMasterMetrics(normalWspm);
  const processes = PROCESS_ASSUMPTIONS.map((process) => {
    const count = M20_DEFINED_EQUIPMENT_COUNTS[process.processCode];
    const supportedCapacityWspm = processSupportedWspm(process, count);
    const stages = process.processCode === "P10"
      ? backendCapacityStages(process.processCode, normalWspm)
      : [];
    const bottleneckStage = stages.length
      ? stages.reduce((highest, stage) => stage.normalPlannedLoad > highest.normalPlannedLoad ? stage : highest)
      : null;
    return {
      processCode: process.processCode,
      name: process.name,
      assessment: process.assessment,
      previousCount: process.previousCount,
      definedCount: count,
      gap: count - process.previousCount,
      ratedWph: process.ratedWph,
      capacityPassesPerWafer: process.capacityPassesPerWafer,
      supportedWspm: supportedCapacityWspm,
      normalPlannedLoad: normalWspm / supportedCapacityWspm,
      bottleneckCapacityStage: bottleneckStage?.stageCode ?? null,
      capacityStages: stages.map((stage) => ({
        stageCode: stage.stageCode,
        name: stage.name,
        equipmentCount: stage.equipmentCount,
        ratedRate: stage.ratedRate,
        capacityUnit: stage.capacityUnit,
        modeledOee: stage.modeledOee,
        normalDemandPerDay: stage.normalDemandPerDay,
        effectiveCapacityPerDay: stage.effectiveCapacityPerDay,
        normalPlannedLoad: stage.normalPlannedLoad,
      })),
    };
  });
  const scenarioGates = (Object.keys(M20_PRODUCTION_SCENARIOS) as M20ProductionScenarioId[]).map((scenarioId) => {
    const scenario = M20_PRODUCTION_SCENARIOS[scenarioId];
    const metrics = assessedMasterMetrics(scenario.waferStartsPerMonth);
    return {
      scenarioId,
      waferStartsPerMonth: scenario.waferStartsPerMonth,
      bottleneckProcessCode: metrics.bottleneckProcessCode,
      bottleneckUtilization: metrics.plannedLoad,
      reservedHeadroom: 1 - metrics.plannedLoad,
      status: scenarioStatus(scenarioId, metrics.plannedLoad),
    };
  });

  return {
    version: FAB_EQUIPMENT_MASTER_VERSION,
    status: M20_EQUIPMENT_DEFINITION_STATUS,
    rateUnit: M20_EQUIPMENT_RATE_UNIT,
    fabDefinitions: [
      { fabId: "M20", product: "HBM4 12-Hi 36GB", referenceWspm: normalWspm, targetReservedHeadroom: 0.15, totalEquipment, status: "INDUSTRY_RANGE_INFORMED_MODELED_BASELINE" },
      { fabId: "M21", product: "TBD", referenceWspm: null, targetReservedHeadroom: null, totalEquipment: null, status: "NOT_MODELED" },
      { fabId: "M22", product: "TBD", referenceWspm: null, targetReservedHeadroom: null, totalEquipment: null, status: "NOT_MODELED" },
    ],
    headroomPolicy: {
      referenceScenario: "NORMAL",
      maxPlannedLoad: M20_NORMAL_MAX_PLANNED_LOAD,
      minimumReservedHeadroom: 1 - M20_NORMAL_MAX_PLANNED_LOAD,
      minimumSupportedWspm: normalWspm / M20_NORMAL_MAX_PLANNED_LOAD,
    },
    p10OutputContract: {
      kgdPerWafer: M20_KGD_PER_WAFER,
      dramDiesPerStack: M20_DRAM_DIES_PER_STACK,
      assemblyYield: M20_ASSEMBLY_YIELD,
      grossStacksPerDay: normalWspm / DAYS_PER_MONTH * M20_KGD_PER_WAFER / M20_DRAM_DIES_PER_STACK,
      goodStacksPerDay: normalWspm / DAYS_PER_MONTH * M20_KGD_PER_WAFER / M20_DRAM_DIES_PER_STACK * M20_ASSEMBLY_YIELD,
      goodStacksPerMonth: normalWspm * M20_KGD_PER_WAFER / M20_DRAM_DIES_PER_STACK * M20_ASSEMBLY_YIELD,
      baseDiePlacementIncluded: false,
      baseDieCapacityStatus: "CAPACITY_PENDING",
      baseDieConsumptionPerGrossStack: 1,
    },
    previousBaselineTotal,
    totalEquipment,
    totalGap: totalEquipment - previousBaselineTotal,
    supportedWspm: masterMetrics.supportedWspm,
    bottleneckProcessCode: masterMetrics.bottleneckProcessCode,
    normalPlannedLoad: masterMetrics.plannedLoad,
    normalReservedHeadroom: 1 - masterMetrics.plannedLoad,
    processes,
    scenarioGates,
    notes: [
      "P05는 wafer 상태의 Capacity planning에서 6 wafer-pass/wafer를 사용하며 Route 노드나 자재 방문수를 늘리지 않습니다.",
      "P10 Packaging은 Dicing·Die Sort·12-Hi Bonding·MUF/Molding·Final Test의 native-unit Capacity 중 최대 부하를 대표값으로 사용합니다.",
      "650 KGD/wafer는 die yield 반영값이며 assembly yield 90%는 Final Test 이후 good stack 산출에 한 번만 적용합니다.",
      "P10.BASE_DIE_ATTACH는 Base Die KGD 1개를 gross stack마다 소비합니다. 설비 Capacity는 검증 전 CAPACITY_PENDING이며 12-Hi Bonding 부하에 합산하지 않습니다.",
      "494대는 실제 구매·설치·qualification 완료 수량이 아닌 M20 modeled equipment definition입니다.",
    ],
  };
}
