import { FAB_SCENARIO, fabScenarioMetrics } from "@/lib/fab-scenario";
import {
  minimumDefinedCount, minimumNativeStageCount, modeledOeeForSequence, nativeStageSupportedWspm,
  resolveTargetLoad, supportedWspm, type NativeCapacityStage,
} from "@/lib/equipment-wph-model";
import type { FabEquipmentMasterView } from "@/lib/fab-equipment-master-view";

export const FAB_EQUIPMENT_MASTER_M22_VERSION = "FAB_EQUIPMENT_MASTER_M22_V2" as const;
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

// P10(16단 와이어본딩 패키징). fab-master.md § NAND 완제품 환산의 1,523 gross die →
// 1,249 양품 die(82%) → 74.94 양품 16-die stack package(96% 조립수율)를 그대로 쓴다.
export const M22_GOOD_DIE_PER_WAFER = 1_249;
export const M22_GOOD_PACKAGE_PER_WAFER = 74.94;

// Backgrind·Dicing은 wafer 단위, Die Attach·Wire Bond는 다이 단위(16단 적층 — 층마다
// 개별 attach·bond가 필요해 패키지가 아니라 다이 기준 driver를 쓴다), Molding·Lead
// Finish·Final Test는 완성 패키지(스택) 단위다. ratedRate는 vendor spec이 아닌 반도체
// 조립·테스트 업계 통상 처리량 범위 추정이다 — Final Test만 공개 문헌(아래 출처)으로
// 뒷받침되고 나머지는 INDUSTRY_RANGE_INFORMED 추정이라 실제 vendor 확보 시 대수가 달라질 수 있다.
export const M22_P10_STAGES: readonly NativeCapacityStage[] = [
  { stageCode: "BACKGRIND", name: "Backgrind", ratedRate: 45, capacityUnit: "WAFER_HOUR", driverPerWafer: 1 },
  { stageCode: "DICING", name: "Dicing / Singulation", ratedRate: 38, capacityUnit: "WAFER_HOUR", driverPerWafer: 1 },
  { stageCode: "DIE_ATTACH", name: "Die Attach", ratedRate: 4_000, capacityUnit: "DIE_HOUR", driverPerWafer: M22_GOOD_DIE_PER_WAFER },
  { stageCode: "WIRE_BOND", name: "Wire Bond(16단 적층)", ratedRate: 6_000, capacityUnit: "DIE_HOUR", driverPerWafer: M22_GOOD_DIE_PER_WAFER },
  { stageCode: "MOLDING", name: "Molding", ratedRate: 2_500, capacityUnit: "PACKAGE_HOUR", driverPerWafer: M22_GOOD_PACKAGE_PER_WAFER },
  { stageCode: "LEAD_FINISH", name: "Lead Finish / Ball Mount", ratedRate: 5_000, capacityUnit: "PACKAGE_HOUR", driverPerWafer: M22_GOOD_PACKAGE_PER_WAFER },
  // Final Test rate: practical UPH at ~1s test time, 0.2s handler index, 60% OEE 가정
  // (James Migliaccio, "Aspects of High Volume Test for Semiconductor Devices", CS MANTECH 2018, Table I).
  { stageCode: "FINAL_TEST", name: "Final Test", ratedRate: 1_800, capacityUnit: "PACKAGE_HOUR", driverPerWafer: M22_GOOD_PACKAGE_PER_WAFER },
];

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

const M22_MAX_PASSES_PER_WAFER = Math.max(...M22_PROCESS_ASSUMPTIONS.map((p) => p.capacityPassesPerWafer));

export const M22_DEFINED_EQUIPMENT_COUNTS: Readonly<Record<M22WphProcessCode, number>> = Object.freeze((() => {
  const normalWspm = m22NormalWspm();
  return Object.fromEntries(M22_PROCESS_ASSUMPTIONS.map((p) => [
    p.processCode,
    minimumDefinedCount(
      p.ratedWph, p.capacityPassesPerWafer, normalWspm,
      resolveTargetLoad(p.capacityPassesPerWafer, M22_MAX_PASSES_PER_WAFER, M22_NORMAL_MAX_PLANNED_LOAD),
    ),
  ]));
})()) as Readonly<Record<M22WphProcessCode, number>>;

// P10 내부 7개 stage도 병목(85%) 기준으로 최소 대수를 구한다 — M20 P10(5-stage)이 이미
// 83~84%대로 병목급으로 운영되는 전례를 따라, P10 전체를 P01~P09의 병목 공정과 같은 급으로 본다.
export const M22_P10_DEFINED_COUNTS: Readonly<Record<string, number>> = Object.freeze((() => {
  const normalWspm = m22NormalWspm();
  return Object.fromEntries(M22_P10_STAGES.map((stage) => [
    stage.stageCode,
    minimumNativeStageCount(stage, normalWspm, M22_NORMAL_MAX_PLANNED_LOAD),
  ]));
})());
export const M22_P10_TOTAL = Object.values(M22_P10_DEFINED_COUNTS).reduce((sum, count) => sum + count, 0);

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

  const p10Stages = M22_P10_STAGES.map((stage) => {
    const count = M22_P10_DEFINED_COUNTS[stage.stageCode];
    const supported = nativeStageSupportedWspm(stage, count);
    return { stage, count, normalPlannedLoad: normalWspm / supported };
  });
  const p10Bottleneck = p10Stages.reduce((highest, row) => row.normalPlannedLoad > highest.normalPlannedLoad ? row : highest);
  processes.push({
    processCode: "P10",
    name: "16단 와이어본딩 패키징",
    definedCount: M22_P10_TOTAL,
    normalPlannedLoad: p10Bottleneck.normalPlannedLoad,
    bottleneckCapacityStage: p10Bottleneck.stage.stageCode,
    capacityStages: M22_P10_STAGES.map((stage) => ({ stageCode: stage.stageCode, name: stage.name })),
  });
  return {
    fabId: "M22",
    normalWspm,
    totalEquipment: processes.reduce((sum, p) => sum + p.definedCount, 0),
    processes,
  };
}
