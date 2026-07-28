import assert from "node:assert/strict";
import { planInbound, settleArrivals } from "../src/lib/twin/inbound";

// MVP-0 캘리브레이션 회귀 가드 (순수 함수, DB 없음).
// 트윈 소모는 tick당 simDays만큼 가속된다(1 sim-day ≈ 6.7 실초). 발주 리드타임을 실벽시계 day로
// 잡으면 재고는 초 단위로 마르는데 발주는 실제 며칠 뒤 도착 → 영구 결품. 리드타임도 같은 가속
// sim-time으로 환산해야 소모↔보충이 같은 시간축에서 평형에 도달한다.

type PO = { _id: string; etaAt: Date; qty: number; materialId: string; status: string };

function simulate(msPerDay: number): { finalOnHand: number; received: number; minOnHand: number; stockoutTicks: number } {
  const tickMs = 5_000;
  const simDaysPerTick = 0.75;
  const burnPerTick = 100;
  const avgDailyBurn = burnPerTick / simDaysPerTick; // 소모율(sim-day 기준)
  const ropDays = 5;
  const leadDays = 5;
  const materialId = "MAT-X";

  let onHand = 1_000;
  let now = 0;
  const pos: PO[] = [];
  let received = 0;
  let minOnHand = onHand;
  let stockoutTicks = 0;
  let seq = 0;

  for (let i = 0; i < 80; i++) {
    // ① 소모
    const burned = Math.min(onHand, burnPerTick);
    onHand -= burned;
    if (onHand <= 0) stockoutTicks++;
    minOnHand = Math.min(minOnHand, onHand);

    // ② 발주 판단 (open PO 기준 inTransit)
    const open = pos.filter((p) => p.status !== "RECEIVED");
    const inTransit = open.reduce((s, p) => s + p.qty, 0);
    const plan = planInbound({ onHand, inTransit, avgDailyBurn, ropDays });
    if (plan) {
      pos.push({ _id: `PO-${seq++}`, etaAt: new Date(now + leadDays * msPerDay), qty: plan.qty, materialId, status: "ORDERED" });
    }

    // ③ 도착 정산
    const arr = settleArrivals(pos, new Date(now));
    for (const r of arr.receipts) { onHand += r.qty; received++; }
    for (const p of pos) if (arr.arrivedPoIds.includes(p._id)) p.status = "RECEIVED";

    now += tickMs;
  }
  return { finalOnHand: onHand, received, minOnHand, stockoutTicks };
}

// 가속 sim-time (수정 후): 1 sim-day = tickMs/simDaysPerTick = 6,667ms
const accel = simulate(5_000 / 0.75);
// 실벽시계 (수정 전 버그): 1 day = 86,400,000ms
const wall = simulate(86_400_000);

// 가속: 발주가 실제로 도착하고 재고가 회복돼 평형에 도달한다
assert.ok(accel.received > 0, "가속 리드타임: 발주가 도착한다");
assert.ok(accel.finalOnHand > 0, "가속 리드타임: 재고가 회복돼 바닥나지 않는다(평형)");

// 실벽시계: 발주가 시뮬 구간 내 절대 도착 못 하고 재고가 영구 결품
assert.equal(wall.received, 0, "실벽시계 리드타임: 발주가 구간 내 도착 못 함");
assert.equal(wall.finalOnHand, 0, "실벽시계 리드타임: 재고 영구 결품");
assert.ok(wall.stockoutTicks > accel.stockoutTicks, "실벽시계가 가속보다 결품 tick이 훨씬 많다");

console.log(`✅ twin 평형 캘리브레이션 통과 — 가속: 도착 ${accel.received}건·최종재고 ${accel.finalOnHand}·최소 ${accel.minOnHand} / 실벽시계: 도착 ${wall.received}건·최종재고 ${wall.finalOnHand}(영구결품)`);
