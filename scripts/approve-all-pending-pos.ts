import "dotenv/config";
import { collections } from "../src/lib/db";
import { getOrInitTwinState } from "../src/lib/twin/state";
import { operatingDaysToMs, OPERATING_SPEED_MULTIPLIER } from "../src/lib/twin/operating-clock";

// decideTwinPurchaseOrder(APPROVE)와 동일한 로직을 PENDING_APPROVAL 전체에 배치로 적용한다.
// INBOUND_HOLD(창고 용량초과로 이미 도착한 화물)는 건드리지 않는다 — 그건 승인 문제가
// 아니라 창고 capacity 문제라 별도로 다뤄야 한다.
//
// 예전에는 `simDaysPerTick = cycleDays / totalSteps`로 ETA를 계산했다 — RULES.md가 금지한
// tick 횟수 기반 시간 진행이다. 리드타임은 운영시간이므로 공통 운영시계만 쓴다.
async function main() {
  const { twinPurchaseOrders } = await collections();
  const pending = await twinPurchaseOrders.find({ status: "PENDING_APPROVAL" }).toArray();
  if (pending.length === 0) { console.log("승인 대기 발주가 없습니다."); return; }

  const state = await getOrInitTwinState();
  const operatingNowMs = state.operatingEpochMs ?? 0;

  let approved = 0;
  for (const po of pending) {
    const now = new Date();
    // 도착 판정 근거는 운영시각이다(§twin/inbound.ts settleArrivals). etaAt은 화면 표시용
    // 벽시계 환산이라 24로 나눈다 — 리드타임은 운영시간이기 때문이다.
    const etaOperatingMs = operatingNowMs + operatingDaysToMs(po.leadTimeDays);
    const etaAt = new Date(now.getTime() + operatingDaysToMs(po.leadTimeDays) / OPERATING_SPEED_MULTIPLIER);
    const result = await twinPurchaseOrders.updateOne(
      { _id: po._id, status: "PENDING_APPROVAL" },
      { $set: { status: "ORDERED", orderedAt: now, etaAt, etaOperatingMs, decidedAt: now, decidedBy: "SCRIPT:approve-all" } },
    );
    if (result.modifiedCount) {
      approved++;
      console.log(`approved ${po.materialId} qty=${Math.round(po.qty)}`);
    }
  }
  console.log(`[approve-all-pending] ${approved}/${pending.length}건 승인 완료`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
