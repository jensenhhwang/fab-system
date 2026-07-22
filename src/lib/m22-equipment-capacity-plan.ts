import { FAB_SCENARIO, fabScenarioMetrics } from "@/lib/fab-scenario";
import { minimumDefinedCount, modeledOeeForSequence, supportedWspm } from "@/lib/equipment-wph-model";
import type { FabEquipmentMasterView } from "@/lib/fab-equipment-master-view";

export const FAB_EQUIPMENT_MASTER_M22_VERSION = "FAB_EQUIPMENT_MASTER_M22_V1" as const;
export const M22_EQUIPMENT_DEFINITION_STATUS = "INDUSTRY_RANGE_INFORMED_MODELED_BASELINE" as const;
export const M22_NORMAL_MAX_PLANNED_LOAD = 0.85;

export type M22WphProcessCode = "P01" | "P02" | "P03" | "P04" | "P05" | "P06" | "P07" | "P09";
export type M22ProcessCode = M22WphProcessCode | "P10";

// docs/fab-equipment-master.md의 M22 표준 설비 대수 표와 동일한 WPH·pass count.
// P01~P07·P09는 M20과 동일 ratedWph 재사용(같은 세대 장비 기술 가정), pass count는 321단 3-deck route(route-master.md § M22)에서 도출.
type M22ProcessAssumption = { processCode: M22WphProcessCode; name: string; ratedWph: number; capacityPassesPerWafer: number };
export const M22_PROCESS_ASSUMPTIONS: readonly M22ProcessAssumption[] = [
  { processCode: "P01", name: "산화(주변 CMOS)", ratedWph: 115, capacityPassesPerWafer: 3 },
  { processCode: "P02", name: "CVD(스택 증착 161 + ONO 1)", ratedWph: 105, capacityPassesPerWafer: 162 },
  { processCode: "P03", name: "포토(주변 3 + Staircase 21)", ratedWph: 92, capacityPassesPerWafer: 24 },
  { processCode: "P04", name: "식각(주변 3 + 채널홀 3 + Staircase 21 + 게이트치환 3)", ratedWph: 108, capacityPassesPerWafer: 30 },
  { processCode: "P05", name: "이온주입(주변 CMOS)", ratedWph: 120, capacityPassesPerWafer: 3 },
  { processCode: "P06", name: "금속배선(주변 3 + 게이트치환 텅스텐 3)", ratedWph: 105, capacityPassesPerWafer: 6 },
  { processCode: "P07", name: "CMP(주변 3 + 평탄화 7)", ratedWph: 98, capacityPassesPerWafer: 10 },
  { processCode: "P09", name: "웨이퍼 테스트", ratedWph: 130, capacityPassesPerWafer: 1 },
];

// P10(16단 와이어본딩 패키징) — wire bonder 등 공개 UPH가 없어 RATE_TBD.
// M20 P10 36대/117,000 WSPM 비율을 M22 NORMAL WSPM에 적용한 placeholder (docs/fab-equipment-master.md 참고).
export const M22_P10_PLACEHOLDER_STAGES: readonly { stageCode: string; name: string; equipmentCount: number }[] = [
  { stageCode: "BACKGRIND", name: "Backgrind", equipmentCount: 2 },
  { stageCode: "DICING", name: "Dicing / Singulation", equipmentCount: 4 },
  { stageCode: "DIE_ATTACH", name: "Die Attach", equipmentCount: 5 },
  { stageCode: "WIRE_BOND", name: "Wire Bond(16단 적층)", equipmentCount: 12 },
  { stageCode: "MOLDING", name: "Molding", equipmentCount: 4 },
  { stageCode: "LEAD_FINISH", name: "Lead Finish / Ball Mount", equipmentCount: 2 },
  { stageCode: "FINAL_TEST", name: "Final Test", equipmentCount: 4 },
];
export const M22_P10_TOTAL = M22_P10_PLACEHOLDER_STAGES.reduce((sum, stage) => sum + stage.equipmentCount, 0);

export function m22NormalWspm(): number {
  const fab = FAB_SCENARIO.find((entry) => entry.id === "M22");
  if (!fab) throw new Error("fab-scenario.ts에서 M22 항목을 찾을 수 없습니다.");
  return fabScenarioMetrics(fab).utilizedWspm;
}

export const M22_PROCESS_RATED_WPH: Readonly<Record<M22WphProcessCode, number>> = Object.freeze(
  Object.fromEntries(M22_PROCESS_ASSUMPTIONS.map((p) => [p.processCode, p.ratedWph])),
) as Readonly<Record<M22WphProcessCode, number>>;

export const M22_PROCESS_PASSES: Readonly<Record<M22WphProcessCode, number>> = Object.freeze(
  Object.fromEntries(M22_PROCESS_ASSUMPTIONS.map((p) => [p.processCode, p.capacityPassesPerWafer])),
) as Readonly<Record<M22WphProcessCode, number>>;

export const M22_DEFINED_EQUIPMENT_COUNTS: Readonly<Record<M22WphProcessCode, number>> = Object.freeze((() => {
  const normalWspm = m22NormalWspm();
  return Object.fromEntries(M22_PROCESS_ASSUMPTIONS.map((p) => [
    p.processCode,
    minimumDefinedCount(p.ratedWph, p.capacityPassesPerWafer, normalWspm, M22_NORMAL_MAX_PLANNED_LOAD),
  ]));
})()) as Readonly<Record<M22WphProcessCode, number>>;

export const M22_TOTAL_EQUIPMENT = Object.values(M22_DEFINED_EQUIPMENT_COUNTS).reduce((sum, count) => sum + count, 0) + M22_P10_TOTAL;

export { modeledOeeForSequence };

export function buildM22FabEquipmentMaster(): FabEquipmentMasterView {
  const normalWspm = m22NormalWspm();
  const processes: FabEquipmentMasterView["processes"] = M22_PROCESS_ASSUMPTIONS.map((process) => {
    const count = M22_DEFINED_EQUIPMENT_COUNTS[process.processCode];
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
    name: "16단 와이어본딩 패키징",
    definedCount: M22_P10_TOTAL,
    normalPlannedLoad: null,
    pendingReason: "와이어본더 등 16단 적층 패키징 장비 공개 UPH 없음 (RATE_TBD)",
    bottleneckCapacityStage: null,
    capacityStages: [],
  });
  return {
    fabId: "M22",
    normalWspm,
    totalEquipment: processes.reduce((sum, p) => sum + p.definedCount, 0),
    processes,
  };
}
