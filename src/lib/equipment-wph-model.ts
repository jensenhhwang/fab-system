// M20의 WPH_PROXY 계산 방법론(src/lib/m20-equipment-capacity-plan.ts)을 M21/M22가 공유하는 순수 함수로 뽑아낸 것.
// M20 파일은 legacy previousCount ratchet이 있어 그대로 두고, 신규 Fab(M21/M22)은 이 공용 함수만 쓴다.

export const HOURS_PER_DAY = 24;
export const DAYS_PER_MONTH = 30;

// migrate-m20-pilot.ts의 MODELED_BASELINE OEE 생성 규칙과 동일하다.
export function modeledOeeForSequence(sequence: number): number {
  if (!Number.isInteger(sequence) || sequence <= 0) throw new Error("장비 sequence는 양의 정수여야 합니다.");
  return Math.round((0.82 + (sequence % 8) * 0.01) * 100) / 100;
}

export function supportedWspm(ratedWph: number, passesPerWafer: number, count: number): number {
  let effectiveWph = 0;
  for (let sequence = 1; sequence <= count; sequence += 1) effectiveWph += ratedWph * modeledOeeForSequence(sequence);
  return (effectiveWph * HOURS_PER_DAY) / passesPerWafer * DAYS_PER_MONTH;
}

// 기존 설치 대수(previousCount) 없는 신규 Fab 기준 — NORMAL 계획 부하율 이하를 만족하는 최소 대수.
export function minimumDefinedCount(ratedWph: number, passesPerWafer: number, normalWspm: number, maxPlannedLoad: number): number {
  let count = 1;
  while (normalWspm / supportedWspm(ratedWph, passesPerWafer, count) > maxPlannedLoad) count += 1;
  return count;
}

// 병목이 아닌 공정까지 85% 상한까지 채우면(=최소 대수) 변동성을 흡수할 여유가 전혀 없다 —
// PM·돌발 다운·수율 재작업을 흡수하는 protective capacity를 남기는 표준 fab capacity planning
// 관행(TOC 병목 관리)에 따라, 병목이 아닌 공정엔 더 낮은 목표 부하를 쓴다.
export const NORMAL_TARGET_LOAD_NON_BOTTLENECK = 0.75;

// 이 fab에서 wafer당 방문 횟수(capacityPassesPerWafer)가 가장 많은 공정(들)만 "병목"으로 보고
// maxPlannedLoad까지 채우고, 나머지는 targetLoadNonBottleneck까지만 채운다.
export function resolveTargetLoad(
  capacityPassesPerWafer: number,
  maxPassesPerWafer: number,
  maxPlannedLoad: number,
  targetLoadNonBottleneck: number = NORMAL_TARGET_LOAD_NON_BOTTLENECK,
): number {
  return capacityPassesPerWafer === maxPassesPerWafer ? maxPlannedLoad : targetLoadNonBottleneck;
}
