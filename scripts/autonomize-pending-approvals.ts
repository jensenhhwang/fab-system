import "dotenv/config";
import { collections } from "../src/lib/db";
import { getOrInitTwinState } from "../src/lib/twin/state";
import { operatingDaysToMs, OPERATING_SPEED_MULTIPLIER } from "../src/lib/twin/operating-clock";

// 사용자 결정: 김구매가 스스로 판단해서 실행하고, 사람의 승인 클릭을 요구하지 않는다.
// engine.ts는 이미 앞으로의 신규 발주에 이 정책을 적용하도록 고쳤다 — 이 스크립트는 그
// 정책 변경 이전에 이미 PENDING_APPROVAL로 쌓여있던 기존 발주들을 같은 정책으로 정리한다.
// autonomyCeiling·autonomyReason은 그대로 남겨서 "왜 위험물/단일소싱으로 분류됐는지" 감사
// 기록은 유지한다 — 상태만 ORDERED로 바뀐다.
async function main() {
  const { twinPurchaseOrders } = await collections();
  const pending = await twinPurchaseOrders.find({ status: "PENDING_APPROVAL" }).toArray();
  if (pending.length === 0) { console.log("승인 대기 발주가 없습니다."); return; }

  const state = await getOrInitTwinState();
  const operatingNowMs = state.operatingEpochMs ?? 0;

  let converted = 0;
  for (const po of pending) {
    const now = new Date();
    // 도착 판정 근거는 운영시각이다. etaAt은 화면 표시용 벽시계 환산.
    const etaOperatingMs = operatingNowMs + operatingDaysToMs(po.leadTimeDays);
    const etaAt = new Date(now.getTime() + operatingDaysToMs(po.leadTimeDays) / OPERATING_SPEED_MULTIPLIER);
    const result = await twinPurchaseOrders.updateOne(
      { _id: po._id, status: "PENDING_APPROVAL" },
      { $set: { status: "ORDERED", orderedAt: now, etaAt, etaOperatingMs, decidedAt: now, decidedBy: "AUTONOMOUS_POLICY_2026-08-08" } },
    );
    if (result.modifiedCount) { converted++; console.log(`autonomized ${po.materialId} qty=${Math.round(po.qty)} reason=${po.autonomyReason}`); }
  }
  console.log(`[autonomize-pending-approvals] ${converted}/${pending.length}건 전환 완료`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
