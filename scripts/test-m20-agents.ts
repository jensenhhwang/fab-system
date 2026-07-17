import assert from "node:assert/strict";
import { calculateM20Procurement, M20_PROCUREMENT_POLICY_V1 } from "../src/lib/m20-agent-policy";

const shortage = calculateM20Procurement({
  onHand: 10_562,
  activeReservations: 98,
  confirmedInbound: 0,
  safetyStock: 500,
  dailyUsage: 676,
  leadTimeDays: M20_PROCUREMENT_POLICY_V1.leadTimeDays,
  moq: M20_PROCUREMENT_POLICY_V1.moq,
  orderMultiple: M20_PROCUREMENT_POLICY_V1.orderMultiple,
});
assert.equal(shortage.projectedAvailable, 10_464);
assert.equal(shortage.policyTarget, 14_696);
assert.equal(shortage.shortage, 4_232);
assert.equal(shortage.quantity, 4_500);

const sufficient = calculateM20Procurement({
  onHand: 20_000,
  activeReservations: 98,
  confirmedInbound: 2_000,
  safetyStock: 500,
  dailyUsage: 676,
  leadTimeDays: 21,
  moq: 1_000,
  orderMultiple: 500,
});
assert.equal(sufficient.quantity, 0);

const moq = calculateM20Procurement({
  onHand: 14_500,
  activeReservations: 0,
  confirmedInbound: 0,
  safetyStock: 500,
  dailyUsage: 676,
  leadTimeDays: 21,
  moq: 1_000,
  orderMultiple: 500,
});
assert.equal(moq.shortage, 196);
assert.equal(moq.quantity, 1_000);

console.log("✅ M20 발주 에이전트 정책: 부족량·MOQ·주문배수 검증 완료");
