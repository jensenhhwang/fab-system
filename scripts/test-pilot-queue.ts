import "dotenv/config";
import { randomUUID } from "crypto";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { getOrCreateActiveLot, getLotRouteState, advanceLotStep } from "../src/lib/lot-route";
import { listPilotQueue, PILOT_STALL_CRITICAL_MS } from "../src/lib/pilot-queue";

const ACTOR = "test-script:pilot-queue";

async function driveToFirstPackagingStep(foupCode: string) {
  const lot = await getOrCreateActiveLot("M20", "HBM", foupCode, ACTOR);
  let state = await getLotRouteState(lot._id);
  let iterations = 0;
  while (!state.isDone && state.currentStepIndex <= 122) {
    state = await advanceLotStep(lot._id, ACTOR, `${lot._id}:${randomUUID()}`);
    iterations++;
    if (iterations > 200) throw new Error("무한루프 방지: 반복 횟수 초과");
  }
  return lot._id;
}

async function main() {
  const { workOrders, transferOrders } = await collections();

  // 1) 서로 다른 FOUP 2개를 각각 패키징 첫 스텝까지 진행시켜 M20_PILOT 워크오더를 2개 만든다.
  const lotIdA = await driveToFirstPackagingStep("FOUP-08");
  const lotIdB = await driveToFirstPackagingStep("FOUP-09");

  const woA = await workOrders.findOne({ requestId: `WLOT-PACKAGING:${lotIdA}:122` });
  const woB = await workOrders.findOne({ requestId: `WLOT-PACKAGING:${lotIdB}:122` });
  assert(woA, "FOUP-08 패키징 워크오더가 없습니다");
  assert(woB, "FOUP-09 패키징 워크오더가 없습니다");
  assert.equal(woA.foupCode, "FOUP-08", "워크오더에 foupCode가 저장되어야 합니다");
  assert.equal(woA.lotId, lotIdA, "워크오더에 lotId가 저장되어야 합니다");
  assert.equal(woB.foupCode, "FOUP-09");
  console.log(`✅ 1) FOUP-08/09 각각 독립 M20_PILOT 워크오더 생성 확인 (lotId/foupCode 저장됨)`);

  // 2) listPilotQueue가 둘 다 반환하고, 방금 생성된 건 stallLevel이 normal이어야 한다.
  const queue = await listPilotQueue("M20");
  const itemA = queue.find((item) => item.workOrder._id === woA._id);
  const itemB = queue.find((item) => item.workOrder._id === woB._id);
  assert(itemA && itemB, "pilot-queue에 두 워크오더가 모두 있어야 합니다");
  assert.equal(itemA.stallLevel, "normal", "방금 생성된 워크오더는 정상 상태여야 합니다");
  assert.equal(itemB.stallLevel, "normal");
  console.log(`✅ 2) listPilotQueue가 FOUP-08/09 워크오더를 모두 반환, 신규 생성분은 stallLevel=normal`);

  // 3) FOUP-08 워크오더의 TransferOrder updatedAt을 임계값 이전 시각으로 되돌려 정체(critical) 판정을 검증한다.
  const transferA = await transferOrders.findOne({ workOrderId: woA._id });
  assert(transferA, "FOUP-08 TransferOrder가 없습니다");
  const staleTime = new Date(Date.now() - PILOT_STALL_CRITICAL_MS - 60_000);
  await transferOrders.updateOne({ _id: transferA._id }, { $set: { updatedAt: staleTime } });
  const queueAfterStall = await listPilotQueue("M20");
  const stalledItemA = queueAfterStall.find((item) => item.workOrder._id === woA._id);
  assert(stalledItemA, "정체 시뮬레이션 후에도 큐에 있어야 합니다");
  assert.equal(stalledItemA.stallLevel, "critical", "임계값을 넘은 워크오더는 critical이어야 합니다");
  const stalledItemB = queueAfterStall.find((item) => item.workOrder._id === woB._id);
  assert.equal(stalledItemB?.stallLevel, "normal", "FOUP-09는 영향을 받지 않아야 합니다");
  console.log(`✅ 3) TransferOrder 정체 시뮬레이션 → stallLevel=critical 판정, 다른 워크오더는 무관하게 normal 유지`);

  console.log("🎉 M20 파일럿 워크오더 큐 + 정체 판정 시나리오 전체 통과");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
