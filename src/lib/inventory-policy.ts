export const INVENTORY_POLICY_VERSION = "BASELINE_V1" as const;

export function calculateBaselineTarget(input: {
  currentQuantity: number; safetyStock: number; dailyUsage: number; ropDays: number; leadTimeDays: number;
}) {
  const protectedDays = Math.max(input.ropDays, input.leadTimeDays);
  const targetQuantity = Math.ceil(Math.max(input.currentQuantity, input.safetyStock, input.dailyUsage * protectedDays));
  return { protectedDays, targetQuantity, shortageQuantity: Math.max(0, targetQuantity - input.currentQuantity) };
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
