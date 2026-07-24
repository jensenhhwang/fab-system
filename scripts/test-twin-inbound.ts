import assert from "node:assert/strict";
import { planInbound, settleArrivals, updateBurnEma } from "../src/lib/twin/inbound";

// EMA: 초기값이 0이면 관측값을 그대로 채택(부트스트랩)
assert.equal(updateBurnEma(0, 100, 0.2), 100, "EMA 부트스트랩");
assert.ok(Math.abs(updateBurnEma(100, 200, 0.2) - 120) < 1e-9, "EMA 0.2*200+0.8*100=120");

// ROP = avgDailyBurn(10) * ropDays(7) = 70. onHand+inTransit = 30 < 70 → 재주문
// 재주문량 = rop*2 - (onHand+inTransit) = 140 - 30 = 110
const plan = planInbound({ onHand: 20, inTransit: 10, avgDailyBurn: 10, ropDays: 7 });
assert.equal(plan?.qty, 110, "ROP 미달 시 재주문량");

// onHand+inTransit >= ROP → 발주 없음
assert.equal(planInbound({ onHand: 100, inTransit: 0, avgDailyBurn: 10, ropDays: 7 }), null, "충분하면 발주 없음");
// avgDailyBurn=0(소모 없음)이면 발주 없음
assert.equal(planInbound({ onHand: 0, inTransit: 0, avgDailyBurn: 0, ropDays: 7 }), null, "소모 없으면 발주 없음");

// 도착 정산: etaAt <= now 이고 아직 RECEIVED 아닌 PO만 입고
const now = new Date("2026-07-25T00:00:00Z");
const pos = [
  { _id: "po1", etaAt: new Date("2026-07-24T00:00:00Z"), qty: 50, materialId: "GAS-001", status: "ORDERED" },
  { _id: "po2", etaAt: new Date("2026-07-26T00:00:00Z"), qty: 30, materialId: "GAS-001", status: "ORDERED" },
  { _id: "po3", etaAt: new Date("2026-07-20T00:00:00Z"), qty: 10, materialId: "CHM-002", status: "RECEIVED" },
];
const res = settleArrivals(pos, now);
assert.deepEqual(res.arrivedPoIds, ["po1"], "도착 대상은 po1만");
assert.equal(res.receipts[0].qty, 50, "입고 수량");

console.log("✅ twin inbound passed");
