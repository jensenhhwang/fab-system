import { calculateBaselineTarget, capacityDecision } from "../src/lib/inventory-policy";

const target = calculateBaselineTarget({ currentQuantity: 100, safetyStock: 120, dailyUsage: 20, ropDays: 7, leadTimeDays: 10 });
console.assert(target.protectedDays === 10 && target.targetQuantity === 200 && target.shortageQuantity === 100, "리드타임 보호수량");
const noDecrease = calculateBaselineTarget({ currentQuantity: 300, safetyStock: 120, dailyUsage: 20, ropDays: 7, leadTimeDays: 10 });
console.assert(noDecrease.targetQuantity === 300 && noDecrease.shortageQuantity === 0, "현재수량 감소 금지");
console.assert(capacityDecision({ capacityMode: "SPACE", currentOccupancy: 50, totalCapacity: 100, legalLimit: null, currentQuantity: 100, targetQuantity: 150, occupancyFactor: 0.5, materialCapacityLimit: null }).allowed, "공간 여유 허용");
console.assert(!capacityDecision({ capacityMode: "SPACE", currentOccupancy: 90, totalCapacity: 100, legalLimit: null, currentQuantity: 100, targetQuantity: 150, occupancyFactor: 0.5, materialCapacityLimit: null }).allowed, "공간 초과 차단");
console.assert(!capacityDecision({ capacityMode: "TANK_LEVEL", currentOccupancy: 68, totalCapacity: 100, legalLimit: null, currentQuantity: 68, targetQuantity: 120, occupancyFactor: 1, materialCapacityLimit: 100 }).allowed, "탱크 초과 차단");
console.log("✅ inventory policy rules passed");
