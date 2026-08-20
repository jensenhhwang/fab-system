export const INVENTORY_POLICY_VERSION = "BASELINE_V1" as const;

export function calculateBaselineTarget(input: {
  currentQuantity: number; safetyStock: number; dailyUsage: number; ropDays: number; leadTimeDays: number;
}) {
  const protectedDays = Math.max(input.ropDays, input.leadTimeDays);
  const targetQuantity = Math.ceil(Math.max(input.currentQuantity, input.safetyStock, input.dailyUsage * protectedDays));
  return { protectedDays, targetQuantity, shortageQuantity: Math.max(0, targetQuantity - input.currentQuantity) };
}

/** 발주점에 두는 도착 여유 — 리드타임의 30%. ROP == LT이면 여유가 정확히 0이라 수요가 흔들리면 결품난다. */
export const REORDER_POINT_SAFETY_FACTOR = 1.3;

/** 만재 대비 발주점 상한 — 탱크를 100%까지 채우도록 잡으면 곧바로 BLOCKED_CAPACITY로 되돌아온다. */
const REORDER_POINT_CAPACITY_HEADROOM = 0.95;

/**
 * ropDays < leadTimeDays 인 자재의 발주점을 마스터 차원에서 교정한다.
 *
 * ROP에 닿아 발주를 걸어도 남은 재고는 ropDays치인데 화물은 leadTimeDays 뒤에 도착한다. 그
 * 차이만큼은 반드시 재고 0을 지나간다. planInbound의 protectedDays = max(ropDays, leadTimeDays)가
 * 즉시 결품까지는 막아주지만 도착 여유가 정확히 0이라, 코드 보정으로 덮지 않고 마스터를 정정한다.
 *
 * 다만 여유를 무한정 줄 수는 없다 — 탱크가 담을 수 있는 양(capacityLimit)을 넘겨 목표재고를 잡으면
 * capacityDecision이 BLOCKED_CAPACITY를 내서 보충 자체가 막힌다. 만재 일수의 95% 안으로 클램프하고,
 * 클램프 결과가 현재 값보다 작으면 현재 값을 유지해 마스터를 후퇴시키지 않는다.
 */
export function correctedReorderPointDays(input: {
  currentRopDays: number; leadTimeDays: number; dailyUsage: number; capacityLimit: number | null;
}): number {
  // ropDays=0은 현장 연속공급(UPW 등) — 발주점 개념이 없다.
  if (input.currentRopDays <= 0) return input.currentRopDays;
  const desired = Math.ceil(input.leadTimeDays * REORDER_POINT_SAFETY_FACTOR);
  const capDays = input.capacityLimit != null && input.dailyUsage > 0
    ? Math.floor((input.capacityLimit / input.dailyUsage) * REORDER_POINT_CAPACITY_HEADROOM)
    : null;
  const capped = capDays != null ? Math.min(desired, capDays) : desired;
  return Math.max(input.currentRopDays, capped);
}

export function capacityDecision(input: {
  capacityMode: "SPACE" | "TANK_LEVEL" | "CONTINUOUS";
  currentOccupancy: number; totalCapacity: number; legalLimit: number | null;
  currentQuantity: number; targetQuantity: number; occupancyFactor: number; materialCapacityLimit: number | null;
}) {
  if (input.capacityMode === "CONTINUOUS") return { allowed: false, projectedOccupancy: input.currentOccupancy, reason: "현장 연속공급 품목은 자동 기준수량 적용 대상이 아닙니다." };
  if (input.capacityMode === "TANK_LEVEL") {
    if (!input.materialCapacityLimit || input.materialCapacityLimit <= 0) return { allowed: false, projectedOccupancy: input.currentOccupancy, reason: "검증 가능한 탱크 용량이 없습니다." };
    const projectedLevel = input.targetQuantity / input.materialCapacityLimit * 100;
    return projectedLevel <= 100
      ? { allowed: true, projectedOccupancy: projectedLevel, reason: null }
      : { allowed: false, projectedOccupancy: projectedLevel, reason: `탱크 용량을 ${Math.round(projectedLevel - 100)}%p 초과합니다.` };
  }
  const delta = Math.max(0, input.targetQuantity - input.currentQuantity) * input.occupancyFactor;
  const projectedOccupancy = input.currentOccupancy + delta;
  const limit = input.legalLimit ?? input.totalCapacity;
  return projectedOccupancy <= limit
    ? { allowed: true, projectedOccupancy, reason: null }
    : { allowed: false, projectedOccupancy, reason: `${input.legalLimit != null ? "법적" : "시설"} 한도를 ${Math.ceil(projectedOccupancy - limit)}만큼 초과합니다.` };
}
