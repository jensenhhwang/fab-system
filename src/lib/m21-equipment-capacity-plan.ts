import { FAB_SCENARIO, fabScenarioMetrics } from "@/lib/fab-scenario";
import {
  minimumDefinedCount, minimumNativeStageCount, modeledOeeForSequence, nativeStageSupportedWspm,
  resolveTargetLoad, supportedWspm, type NativeCapacityStage,
} from "@/lib/equipment-wph-model";
import type { FabEquipmentMasterView } from "@/lib/fab-equipment-master-view";

export const FAB_EQUIPMENT_MASTER_M21_VERSION = "FAB_EQUIPMENT_MASTER_M21_V2" as const;
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

// P10(conventional 단일 다이 패키징, SDP — 적층 없음). fab-master.md § DRAM 완제품 환산의
// 863 gross die → 759 양품 die(88%) → 743.8 양품 package(98% 조립수율)를 그대로 쓴다.
export const M21_GOOD_DIE_PER_WAFER = 759;
export const M21_GOOD_PACKAGE_PER_WAFER = 743.8;

// Backgrind·Dicing은 wafer 단위(웨이퍼당 1회), Die Attach·Wire Bond는 다이 단위(적층이
// 없어 다이=패키지 1:1이지만 본딩 자체는 다이별 인덱싱), Molding·Lead Finish·Final Test는
// 완성 패키지 단위다. ratedRate는 vendor spec이 아닌 반도체 조립·테스트 업계 통상 처리량
// 범위 추정이다 — Final Test만 공개 문헌(아래 출처)으로 뒷받침되고 나머지는
// INDUSTRY_RANGE_INFORMED 추정이라 실제 vendor 확보 시 대수가 달라질 수 있다.
export const M21_P10_STAGES: readonly NativeCapacityStage[] = [
  { stageCode: "BACKGRIND", name: "Backgrind(단일-패스)", ratedRate: 45, capacityUnit: "WAFER_HOUR", driverPerWafer: 1 },
  { stageCode: "DICING", name: "Dicing / Singulation", ratedRate: 38, capacityUnit: "WAFER_HOUR", driverPerWafer: 1 },
  { stageCode: "DIE_ATTACH", name: "Die Attach", ratedRate: 4_000, capacityUnit: "DIE_HOUR", driverPerWafer: M21_GOOD_DIE_PER_WAFER },
  { stageCode: "WIRE_BOND", name: "Wire Bond", ratedRate: 6_000, capacityUnit: "DIE_HOUR", driverPerWafer: M21_GOOD_DIE_PER_WAFER },
  { stageCode: "MOLDING", name: "Molding", ratedRate: 2_500, capacityUnit: "PACKAGE_HOUR", driverPerWafer: M21_GOOD_PACKAGE_PER_WAFER },
  { stageCode: "LEAD_FINISH", name: "Lead Finish / Ball Mount", ratedRate: 5_000, capacityUnit: "PACKAGE_HOUR", driverPerWafer: M21_GOOD_PACKAGE_PER_WAFER },
  // Final Test rate: practical UPH at ~1s test time, 0.2s handler index, 60% OEE 가정
  // (James Migliaccio, "Aspects of High Volume Test for Semiconductor Devices", CS MANTECH 2018, Table I).
  { stageCode: "FINAL_TEST", name: "Final Test", ratedRate: 1_800, capacityUnit: "PACKAGE_HOUR", driverPerWafer: M21_GOOD_PACKAGE_PER_WAFER },
];

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

// P10 내부 7개 stage도 병목(85%) 기준으로 최소 대수를 구한다 — M20 P10(5-stage)이 이미
// 83~84%대로 병목급으로 운영되는 전례를 따라, P10 전체를 P01~P09의 병목 공정과 같은 급으로 본다.
export const M21_P10_DEFINED_COUNTS: Readonly<Record<string, number>> = Object.freeze((() => {
  const normalWspm = m21NormalWspm();
  return Object.fromEntries(M21_P10_STAGES.map((stage) => [
    stage.stageCode,
    minimumNativeStageCount(stage, normalWspm, M21_NORMAL_MAX_PLANNED_LOAD),
  ]));
})());
export const M21_P10_TOTAL = Object.values(M21_P10_DEFINED_COUNTS).reduce((sum, count) => sum + count, 0);

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

  const p10Stages = M21_P10_STAGES.map((stage) => {
    const count = M21_P10_DEFINED_COUNTS[stage.stageCode];
    const supported = nativeStageSupportedWspm(stage, count);
    return { stage, count, normalPlannedLoad: normalWspm / supported };
  });
  const p10Bottleneck = p10Stages.reduce((highest, row) => row.normalPlannedLoad > highest.normalPlannedLoad ? row : highest);
  processes.push({
    processCode: "P10",
    name: "Conventional 단일 다이 패키징",
    definedCount: M21_P10_TOTAL,
    normalPlannedLoad: p10Bottleneck.normalPlannedLoad,
    bottleneckCapacityStage: p10Bottleneck.stage.stageCode,
    capacityStages: M21_P10_STAGES.map((stage) => ({ stageCode: stage.stageCode, name: stage.name })),
  });
  return {
    fabId: "M21",
    normalWspm,
    totalEquipment: processes.reduce((sum, p) => sum + p.definedCount, 0),
    processes,
  };
}
