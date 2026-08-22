// 공정(bay) 단위 가동 현황 — 계획과 실측을 하나의 축에 올린다.
//
// 배경: /usage의 "공정별 설비 대수·계획 부하" 카드와 "FAB 노드 밀도" 카드가 서로 다른 축을 써서
// 나란히 놓아도 대응이 안 됐다. 전자는 processCode(P01~P10) × 설계 WSPM 기준 정적 계획이고,
// 후자는 routeMaster nodeId × 실시간 WIP다. routeMaster의 노드 하나(cell-array)가 P02·P03·P04·P07을
// 모두 포함하고, 거꾸로 P07은 cell-array에도 beol-metal에도 나오기 때문에 두 축은 겹치지 않는다.
//
// 실측(2026-08-12 M20): 계획 부하는 전 공정이 70~85%로 고르게 나오는데, 실제 WIP은 P03 45.6%·
// P07 36.6%에 몰리고 P02·P04는 0%였다. 화면은 "모든 공정이 계획 범위에서 고르게 돈다"고 말하는데
// 실제 라인은 두 공정 앞에 전부 서 있었다.
//
// 이 모듈은 WIP을 스텝의 processCode로 되접어 계획 부하와 같은 축에 올리고, 적체가 보이면
// 그 원인이 자재 결품인지 설비 부족인지까지 판정한다. 세 경우(자재 대기 / 설비 부족 / 정상)가
// 화면에서 똑같아 보이던 게 문제였다 — 오늘 "P03·P07에 WIP 82%가 뭉쳐 있다"를 알아내는 데
// DB 직접 조회가 필요했던 이유다.

// 설비 계획 부하가 이 값 이상이면 "설비가 빠듯하다"고 본다.
// m20-equipment-capacity-plan.ts의 M20_NORMAL_MAX_PLANNED_LOAD(계획 상한 85%)와 같은 기준선이다.
export const BAY_CAPACITY_TIGHT_THRESHOLD = 0.85;

// 실제 WIP 비중이 기대 비중보다 이만큼(%p) 넘게 벗어나야 적체/기아로 본다.
// 흐름은 원래 조금씩 출렁이므로, 작은 편차까지 경보로 올리면 경보가 의미를 잃는다.
export const BAY_CONGESTION_DEVIATION_PP = 10;

export type BayLoadReason =
  | "MATERIAL_BLOCKED" // 적체 + 그 공정이 쓰는 자재가 결품 — 즉시 조치 가능
  | "CAPACITY_TIGHT"   // 적체 + 설비 계획 부하가 임계 이상 — 증설 검토 대상
  | "CONGESTED"        // 적체인데 위 둘로 설명이 안 됨
  | "STARVED"          // 기대보다 크게 비어 있음 — 앞 공정이 막혀 굶는 중
  | "NORMAL";

export type BayLoad = {
  processCode: string;
  /** 그 공정 스텝에 서 있는 WIP(로트 또는 FOUP-equivalent) */
  wipCount: number;
  /** 전체 WIP 대비 실제 비중(%) */
  actualPercent: number;
  /** route에서 그 공정이 차지하는 스텝 비중(%) — 흐름이 정상이라면 WIP도 이 비율이 된다 */
  expectedPercent: number;
  /** actualPercent − expectedPercent (%p). 양수면 적체, 음수면 기아 */
  deviationPp: number;
  /** 설비 계획 부하(0~1). 평가 보류 공정은 null */
  plannedLoad: number | null;
  equipmentCount: number;
  /** 이 공정이 쓰는 자재 중 지금 결품인 것 */
  blockingMaterialIds: string[];
  reason: BayLoadReason;
};

export type BayLoadInput = {
  /** expandRouteMaster 결과 — 스텝별 processCode */
  visits: { stepIndex: number; processCode: string }[];
  /** stepIndex → 그 스텝에 서 있는 WIP 수 */
  wipByStepIndex: Record<number, number>;
  /** processCode → 그 공정이 소모하는 자재 */
  materialsByProcess: Record<string, string[]>;
  /** 지금 재고가 0인 자재(materials-agent.blockingMaterialIds와 같은 집합) */
  stockoutMaterialIds: ReadonlySet<string>;
  plannedLoadByProcess: Record<string, number | null>;
  equipmentCountByProcess: Record<string, number>;
};

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeBayLoads(input: BayLoadInput): BayLoad[] {
  const { visits, wipByStepIndex, materialsByProcess, stockoutMaterialIds } = input;

  // route가 실제로 지나는 공정만 대상이다 — 설비 마스터에 있어도 그 fab의 route가 안 지나면
  // bay 부하라는 개념이 성립하지 않는다(M20 route의 P05 등).
  const stepsByProcess = new Map<string, number>();
  for (const visit of visits) {
    stepsByProcess.set(visit.processCode, (stepsByProcess.get(visit.processCode) ?? 0) + 1);
  }

  const wipByProcess = new Map<string, number>();
  for (const visit of visits) {
    const wip = wipByStepIndex[visit.stepIndex];
    if (!wip) continue;
    wipByProcess.set(visit.processCode, (wipByProcess.get(visit.processCode) ?? 0) + wip);
  }
  const totalWip = [...wipByProcess.values()].reduce((sum, v) => sum + v, 0);
  const totalSteps = visits.length;

  const loads: BayLoad[] = [];
  for (const [processCode, stepCount] of stepsByProcess) {
    const wipCount = wipByProcess.get(processCode) ?? 0;
    // WIP이 하나도 없으면(라인 전체 정지) 0으로 나누지 않고 전부 0으로 둔다.
    const actualPercent = totalWip > 0 ? round1((wipCount / totalWip) * 100) : 0;
    const expectedPercent = totalSteps > 0 ? round1((stepCount / totalSteps) * 100) : 0;
    const deviationPp = round1(actualPercent - expectedPercent);

    const plannedLoad = input.plannedLoadByProcess[processCode] ?? null;
    const blockingMaterialIds = (materialsByProcess[processCode] ?? []).filter((id) => stockoutMaterialIds.has(id));

    // 적체가 아닌데 결품 자재가 있다는 이유만으로 빨갛게 칠하지 않는다 — 아직 WIP이 안 쌓인
    // 공정까지 경보로 올리면 "지금 무엇이 라인을 세우고 있나"가 도로 흐려진다. 결품 사실
    // 자체(blockingMaterialIds)는 그대로 실어 보내되, reason은 NORMAL로 둔다.
    let reason: BayLoadReason = "NORMAL";
    if (deviationPp >= BAY_CONGESTION_DEVIATION_PP) {
      // 자재 결품과 설비 과부하가 겹치면 자재를 먼저 말한다 — 자재는 오늘 조치할 수 있는
      // 원인이고 설비 증설은 몇 달짜리 결정이다. 둘 다 띄우면 무엇부터 볼지 흐려진다.
      if (blockingMaterialIds.length > 0) reason = "MATERIAL_BLOCKED";
      else if (plannedLoad != null && plannedLoad >= BAY_CAPACITY_TIGHT_THRESHOLD) reason = "CAPACITY_TIGHT";
      else reason = "CONGESTED";
    } else if (deviationPp <= -BAY_CONGESTION_DEVIATION_PP) {
      reason = "STARVED";
    }

    loads.push({
      processCode,
      wipCount,
      actualPercent,
      expectedPercent,
      deviationPp,
      plannedLoad,
      equipmentCount: input.equipmentCountByProcess[processCode] ?? 0,
      blockingMaterialIds,
      reason,
    });
  }

  return loads.sort((a, b) => a.processCode.localeCompare(b.processCode));
}
