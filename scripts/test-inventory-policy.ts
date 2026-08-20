import assert from "node:assert/strict";
import { calculateBaselineTarget, capacityDecision, correctedReorderPointDays, REORDER_POINT_SAFETY_FACTOR } from "../src/lib/inventory-policy";

const target = calculateBaselineTarget({ currentQuantity: 100, safetyStock: 120, dailyUsage: 20, ropDays: 7, leadTimeDays: 10 });
console.assert(target.protectedDays === 10 && target.targetQuantity === 200 && target.shortageQuantity === 100, "리드타임 보호수량");
const noDecrease = calculateBaselineTarget({ currentQuantity: 300, safetyStock: 120, dailyUsage: 20, ropDays: 7, leadTimeDays: 10 });
console.assert(noDecrease.targetQuantity === 300 && noDecrease.shortageQuantity === 0, "현재수량 감소 금지");
console.assert(capacityDecision({ capacityMode: "SPACE", currentOccupancy: 50, totalCapacity: 100, legalLimit: null, currentQuantity: 100, targetQuantity: 150, occupancyFactor: 0.5, materialCapacityLimit: null }).allowed, "공간 여유 허용");
console.assert(!capacityDecision({ capacityMode: "SPACE", currentOccupancy: 90, totalCapacity: 100, legalLimit: null, currentQuantity: 100, targetQuantity: 150, occupancyFactor: 0.5, materialCapacityLimit: null }).allowed, "공간 초과 차단");
console.assert(!capacityDecision({ capacityMode: "TANK_LEVEL", currentOccupancy: 68, totalCapacity: 100, legalLimit: null, currentQuantity: 68, targetQuantity: 120, occupancyFactor: 1, materialCapacityLimit: 100 }).allowed, "탱크 초과 차단");
// ── correctedReorderPointDays — ROP < 리드타임 구조적 결품의 마스터 교정 ──────────
// ROP에 닿아 발주를 걸어도 남은 재고는 ropDays치인데 화물은 leadTimeDays 뒤에 온다. 그 차이만큼은
// 반드시 재고 0을 지나간다. 도착 여유를 리드타임의 30%로 두되, 탱크가 담을 수 있는 양을 넘겨
// 잡으면 BLOCKED_CAPACITY로 되돌아오므로 만재 한도의 95% 안으로 클램프한다.
assert.equal(REORDER_POINT_SAFETY_FACTOR, 1.3, "도착 여유 계수");

assert.equal(
  correctedReorderPointDays({ currentRopDays: 7, leadTimeDays: 10, dailyUsage: 20, capacityLimit: null }), 13,
  "ROP가 리드타임보다 짧으면 ceil(LT×1.3)로 올린다",
);

assert.equal(
  correctedReorderPointDays({ currentRopDays: 30, leadTimeDays: 10, dailyUsage: 20, capacityLimit: null }), 30,
  "이미 충분한 ROP는 내리지 않는다",
);

assert.equal(
  correctedReorderPointDays({ currentRopDays: 7, leadTimeDays: 7, dailyUsage: 471, capacityLimit: 4849 }), 9,
  "탱크 만재 한도(4849/471=10.3일)의 95%=9일 안으로 클램프 — CHM-003 황산 실측",
);

assert.equal(
  correctedReorderPointDays({ currentRopDays: 10, leadTimeDays: 11, dailyUsage: 551.6, capacityLimit: 5680 }), 10,
  "클램프 결과가 현재 ROP보다 작으면 현재 ROP를 유지한다 — 마스터를 후퇴시키지 않는다",
);

assert.equal(
  correctedReorderPointDays({ currentRopDays: 7, leadTimeDays: 10, dailyUsage: 0, capacityLimit: 5000 }), 13,
  "일사용량이 0이면 만재 일수를 계산할 수 없으므로 클램프하지 않는다",
);

assert.equal(
  correctedReorderPointDays({ currentRopDays: 0, leadTimeDays: 10, dailyUsage: 20, capacityLimit: null }), 0,
  "ropDays=0(현장 연속공급)은 발주점 개념이 없으므로 건드리지 않는다",
);

console.log("✅ inventory policy rules passed");
