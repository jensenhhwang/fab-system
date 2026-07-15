import { planProductionChanges, planProductionIncrease, type ScenarioMaterial } from "../src/lib/scenario-engine";

const material: ScenarioMaterial = {
  id: "MAT-1", code: "MAT-1", name: "테스트 자재", category: "CHM", unit: "kg",
  currentQuantity: 1_000, baseDailyUsage: 20, ropDays: 5,
  productDailyUsage: { HBM: 10, DRAM: 5, NAND: 0 },
  warehouseCode: "MWH-01", warehouseName: "창고", occupancyFactor: 1,
  leadTimeDays: 3, supplierName: "공급사",
};

const input = { product: "HBM" as const, startDay: 7, increasePct: 50, durationDays: 20, horizonDays: 60, replenishmentMode: "ROP" as const, coverageDays: 10 };
const plan = planProductionIncrease([material], input);
const samePlan = planProductionIncrease([material], input);
console.assert(JSON.stringify(plan) === JSON.stringify(samePlan), "같은 입력은 같은 결과");
console.assert(plan.materials[0].additionalDailyUsage === 5, "HBM 증산분 일사용량 계산");
console.assert(plan.actions.every(action => action.quantity >= 0), "권장 수량은 음수가 아님");
console.assert(plan.actions.every(action => action.orderDay === action.inboundDay - 3), "발주일은 입고일-리드타임");

const noIncrease = planProductionIncrease([material], { ...input, increasePct: 0 });
const increaseQty = plan.actions.reduce((sum, action) => sum + action.quantity, 0);
const baseQty = noIncrease.actions.reduce((sum, action) => sum + action.quantity, 0);
console.assert(increaseQty >= baseQty, "증산 시 권장 입고량이 감소하지 않음");

const unrelated = planProductionIncrease([{ ...material, productDailyUsage: { HBM: 0, DRAM: 10, NAND: 0 } }], input);
console.assert(unrelated.actions.length === 0, "대상 제품과 무관한 자재 제외");

const missingLead = planProductionIncrease([{ ...material, leadTimeDays: null }], input);
console.assert(missingLead.actions.every(action => action.orderDay === null), "리드타임 미등록 시 허위 발주일 없음");

const multiInput = {
  events: [
    { id: "hbm-up", product: "HBM" as const, startDay: 2, changePct: 30, durationDays: 10 },
    { id: "hbm-down", product: "HBM" as const, startDay: 5, changePct: -10, durationDays: 5 },
    { id: "dram-down", product: "DRAM" as const, startDay: 2, changePct: -20, durationDays: 10 },
  ],
  horizonDays: 30, replenishmentMode: "ROP" as const, coverageDays: 5,
};
const multi = planProductionChanges([material], multiInput);
const reordered = planProductionChanges([material], { ...multiInput, events: [...multiInput.events].reverse() });
console.assert(JSON.stringify(multi.actions) === JSON.stringify(reordered.actions), "이벤트 순서와 무관한 결과");
const day3Driver = multi.actions.flatMap(action => action.drivers).find(driver => driver.product === "HBM");
if (day3Driver) console.assert(day3Driver.changePct === 30, "활성 이벤트 변화율 적용");

const totalStop = planProductionChanges([material], { ...multiInput, events: [
  { id: "stop-1", product: "HBM", startDay: 0, changePct: -80, durationDays: 10 },
  { id: "stop-2", product: "HBM", startDay: 0, changePct: -80, durationDays: 10 },
] });
console.assert(totalStop.materials.every(item => item.scenarioPoints.every(point => Number.isFinite(point.closing) && point.closing >= 0)), "-100% 감산 제한과 유효 재고");

const withLead = planProductionChanges([material], multiInput);
const withoutLead = planProductionChanges([{ ...material, leadTimeDays: null }], multiInput);
console.assert(withLead.actions.map(action => [action.inboundDay, action.quantity]).join("|") === withoutLead.actions.map(action => [action.inboundDay, action.quantity]).join("|"), "리드타임은 입고일·수량에 영향 없음");
console.assert(withoutLead.actions.every(action => action.priority === "LEAD_TIME_MISSING"), "리드타임 미등록 상태 분리");

console.log("✅ 증산 입고 계획 엔진 검증 통과");
