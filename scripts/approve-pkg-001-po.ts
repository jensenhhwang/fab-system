import "dotenv/config";
import { collections } from "../src/lib/db";
import { getOrInitTwinState } from "../src/lib/twin/state";
import { operatingDaysToMs, OPERATING_SPEED_MULTIPLIER } from "../src/lib/twin/operating-clock";

// decideTwinPurchaseOrder(APPROVE)와 동일한 로직 — 그 파일은 "server-only"를 import해서
// 스크립트에서 직접 못 부르니 그대로 복제한다. 승인 시점부터 리드타임이 시작된다.
async function main() {
  const { twinPurchaseOrders } = await collections();
  const po = await twinPurchaseOrders.findOne({ materialId: "PKG-001", status: "PENDING_APPROVAL" });
  if (!po) throw new Error("PKG-001 PENDING_APPROVAL 발주를 찾을 수 없습니다.");

  const now = new Date();
  const state = await getOrInitTwinState();
  // 도착 판정 근거는 운영시각이다. etaAt은 화면 표시용 벽시계 환산.
  const etaOperatingMs = (state.operatingEpochMs ?? 0) + operatingDaysToMs(po.leadTimeDays);
  const etaAt = new Date(now.getTime() + operatingDaysToMs(po.leadTimeDays) / OPERATING_SPEED_MULTIPLIER);

  await twinPurchaseOrders.updateOne(
    { _id: po._id, status: "PENDING_APPROVAL" },
    { $set: { status: "ORDERED", orderedAt: now, etaAt, etaOperatingMs, decidedAt: now, decidedBy: "admin@fab.skh" } },
  );
  console.log(`[approve-pkg-001] PO=${po._id} qty=${Math.round(po.qty)} approved, eta in ~${Math.round((etaAt.getTime() - now.getTime()) / 1000)}s`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
