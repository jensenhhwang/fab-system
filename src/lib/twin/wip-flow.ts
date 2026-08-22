import { operatingDaysToMs, operatingMsToDays } from "@/lib/twin/operating-clock";

/** STEP_BUCKET 수치적분 단위. 운영 5분은 24×에서 실제 12.5초다. */
export const WIP_FLOW_QUANTUM_MS = 5 * 60_000;

export type WipFlowWindow = {
  quantumCount: number;
  processedOperatingMs: number;
  processedOperatingDays: number;
  nextCarryMs: number;
};

/**
 * 공통 운영 경과시간을 완성된 5분 퀀텀과 잔여분으로 나눈다.
 * tick을 몇 번으로 쪼개도 총 퀀텀 수와 잔여분은 같다.
 */
export function planWipFlowWindow(input: {
  elapsedOperatingMs: number;
  carryMs: number;
}): WipFlowWindow {
  const elapsed = Math.max(0, input.elapsedOperatingMs);
  const carry = Math.max(0, input.carryMs);
  const total = carry + elapsed;
  const quantumCount = Math.floor(total / WIP_FLOW_QUANTUM_MS);
  const processedOperatingMs = quantumCount * WIP_FLOW_QUANTUM_MS;
  return {
    quantumCount,
    processedOperatingMs,
    processedOperatingDays: operatingMsToDays(processedOperatingMs),
    nextCarryMs: total - processedOperatingMs,
  };
}

/** 승인 cycle time을 현재 route 스텝에 균등 배분한 평균 체류 운영시간. */
export function stepDwellOperatingMs(cycleTimeDays: number, totalSteps: number): number {
  if (!Number.isFinite(cycleTimeDays) || cycleTimeDays <= 0) {
    throw new Error("cycleTimeDays는 0보다 커야 합니다.");
  }
  if (!Number.isInteger(totalSteps) || totalSteps <= 0) {
    throw new Error("totalSteps는 양의 정수여야 합니다.");
  }
  return operatingDaysToMs(cycleTimeDays / totalSteps);
}

/** 기존 로트의 첫 예정시각을 체류시간 안에 재현 가능하게 분산한다(FNV-1a). */
export function stableOperatingPhaseMs(key: string, spanMs: number): number {
  if (!Number.isFinite(spanMs) || spanMs <= 1) {
    throw new Error("spanMs는 1보다 커야 합니다.");
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return Math.max(
    1,
    Math.min(spanMs - 1, Math.floor(((hash + 1) / 0x1_0000_0001) * spanMs)),
  );
}
