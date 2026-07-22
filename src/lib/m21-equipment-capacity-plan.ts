import { FAB_SCENARIO, fabScenarioMetrics } from "@/lib/fab-scenario";
import { minimumDefinedCount, modeledOeeForSequence, resolveTargetLoad, supportedWspm } from "@/lib/equipment-wph-model";
import type { FabEquipmentMasterView } from "@/lib/fab-equipment-master-view";

export const FAB_EQUIPMENT_MASTER_M21_VERSION = "FAB_EQUIPMENT_MASTER_M21_V1" as const;
export const M21_EQUIPMENT_DEFINITION_STATUS = "INDUSTRY_RANGE_INFORMED_MODELED_BASELINE" as const;
export const M21_NORMAL_MAX_PLANNED_LOAD = 0.85;

export type M21WphProcessCode = "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P07" | "P09";
export type M21ProcessCode = M21WphProcessCode | "P10";

// docs/fab-equipment-master.md의 M21 표준 설비 대수 표와 동일한 WPH·pass count.
// P01~P07·P09는 M20과 동일 ratedWph 재사용(같은 세대 DRAM 프런트엔드 물리 공정), pass count는 M21 route(TSV 없음, P09 1회)에서 도출.
type M21ProcessAssumption = { processCode: M21WphProcessCode; name: string; ratedWph: number; capacityPassesPerWafer: number };
export const M21_PROCESS_ASSUMPTIONS: readonly M21ProcessAssumption[] = [
  { processCode: "P01", name: "산화", ratedWph: 115, capacityPassesPerWafer: 4 },
  { processCode: "P02", name: "CVD", ratedWph: 105, capacityPassesPerWafer: 27 },
  { processCode: "P03", name: "포토", ratedWph: 92, capacityPassesPerWafer: 27 },
  { processCode: "P04", name: "식각", ratedWph: 108, capacityPassesPerWafer: 27 },
  { processCode: "P05", name: "이온주입", ratedWph: 120, capacityPassesPerWafer: 6 },
  { processCode: "P06", name: "금속배선", ratedWph: 105, capacityPassesPerWafer: 5 },
  { processCode: "P07", name: "CMP", ratedWph: 98, capacityPassesPerWafer: 27 },
  { processCode: "P09", name: "웨이퍼 테스트", ratedWph: 130, capacityPassesPerWafer: 1 },
];

// P10(conventional 단일 다이 패키징) — wire bonder 등 공개 UPH가 없어 RATE_TBD.
// M20 P10 36대/117,000 WSPM 비율을 M21 NORMAL WSPM에 적용한 placeholder (docs/fab-equipment-master.md 참고).
export const M21_P10_PLACEHOLDER_STAGES: readonly { stageCode: string; name: string; equipmentCount: number }[] = [
  { stageCode: "BACKGRIND", name: "Backgrind(단일-패스)", equipmentCount: 5 },
  { stageCode: "DICING", name: "Dicing / Singulation", equipmentCount: 8 },
  { stageCode: "DIE_ATTACH", name: "Die Attach", equipmentCount: 7 },
  { stageCode: "WIRE_BOND", name: "Wire Bond", equipmentCount: 17 },
  { stageCode: "MOLDING", name: "Molding", equipmentCount: 7 },
  { stageCode: "LEAD_FINISH", name: "Lead Finish / Ball Mount", equipmentCount: 5 },
  { stageCode: "FINAL_TEST", name: "Final Test", equipmentCount: 8 },
];
export const M21_P10_TOTAL = M21_P10_PLACEHOLDER_STAGES.reduce((sum, stage) => sum + stage.equipmentCount, 0);

export function m21NormalWspm(): number {
  const fab = FAB_SCENARIO.find((entry) => entry.id === "M21");
  if (!fab) throw new Error("fab-scenario.ts에서 M21 항목을 찾을 수 없습니다.");
  return fabScenarioMetrics(fab).utilizedWspm;
}

export const M21_PROCESS_RATED_WPH: Readonly<Record<M21WphProcessCode, number>> = Object.freeze(
  Object.fromEntries(M21_PROCESS_ASSUMPTIONS.map((p) => [p.processCode, p.ratedWph])),
) as Readonly<Record<M21WphProcessCode, number>>;

export const M21_PROCESS_PASSES: Readonly<Record<M21WphProcessCode, number>> = Object.freeze(
  Object.fromEntries(M21_PROCESS_ASSUMPTIONS.map((p) => [p.processCode, p.capacityPassesPerWafer])),
) as Readonly<Record<M21WphProcessCode, number>>;

const M21_MAX_PASSES_PER_WAFER = Math.max(...M21_PROCESS_ASSUMPTIONS.map((p) => p.capacityPassesPerWafer));

export const M21_DEFINED_EQUIPMENT_COUNTS: Readonly<Record<M21WphProcessCode, number>> = Object.freeze((() => {
  const normalWspm = m21NormalWspm();
  return Object.fromEntries(M21_PROCESS_ASSUMPTIONS.map((p) => [
    p.processCode,
    minimumDefinedCount(
      p.ratedWph, p.capacityPassesPerWafer, normalWspm,
      resolveTargetLoad(p.capacityPassesPerWafer, M21_MAX_PASSES_PER_WAFER, M21_NORMAL_MAX_PLANNED_LOAD),
    ),
  ]));
})()) as Readonly<Record<M21WphProcessCode, number>>;

export const M21_TOTAL_EQUIPMENT = Object.values(M21_DEFINED_EQUIPMENT_COUNTS).reduce((sum, count) => sum + count, 0) + M21_P10_TOTAL;

export { modeledOeeForSequence };

export function buildM21FabEquipmentMaster(): FabEquipmentMasterView {
  const normalWspm = m21NormalWspm();
  const processes: FabEquipmentMasterView["processes"] = M21_PROCESS_ASSUMPTIONS.map((process) => {
    const count = M21_DEFINED_EQUIPMENT_COUNTS[process.processCode];
    const supported = supportedWspm(process.ratedWph, process.capacityPassesPerWafer, count);
    return {
      processCode: process.processCode,
      name: process.name,
      definedCount: count,
      normalPlannedLoad: normalWspm / supported,
      bottleneckCapacityStage: null,
      capacityStages: [],
    };
  });
  processes.push({
    processCode: "P10",
    name: "Conventional 단일 다이 패키징",
    definedCount: M21_P10_TOTAL,
    normalPlannedLoad: null,
    pendingReason: "Wire bonder 등 conventional 패키징 장비 공개 UPH 없음 (RATE_TBD)",
    bottleneckCapacityStage: null,
    capacityStages: [],
  });
  return {
    fabId: "M21",
    normalWspm,
    totalEquipment: processes.reduce((sum, p) => sum + p.definedCount, 0),
    processes,
  };
}
