import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { advanceAggregateWip, AUTO_ADVANCE_INTERVAL_MS } from "../src/lib/lot-route";
import { getRouteMaster, expandRouteMaster } from "../src/lib/route-master";

async function main() {
  const { waferLots } = await collections();
  const lotId = "WLOT:M20:HBM:AGG:test-advance";
  await waferLots.deleteOne({ _id: lotId });
  const staleTime = new Date(Date.now() - AUTO_ADVANCE_INTERVAL_MS - 1_000);
  await waferLots.insertOne({
    _id: lotId, fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-WIP-TEST",
    status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 5, currentNodeId: "placeholder",
    lastEventAt: staleTime, createdBy: "test", createdAt: staleTime, updatedAt: staleTime,
  });

  const result = await advanceAggregateWip("M20", "HBM");
  assert(result.advanced >= 1, "기한이 지난 로트는 진행되어야 합니다");
  console.log(`✅ 1) advanced=${result.advanced} completed=${result.completed}`);

  const after = await waferLots.findOne({ _id: lotId });
  assert(after, "로트를 찾을 수 없습니다");
  assert.equal(after.currentStepIndex, 6, "스텝이 1 증가해야 합니다");
  assert(after.lastEventAt, "lastEventAt이 없습니다");
  assert(after.lastEventAt.getTime() > staleTime.getTime(), "lastEventAt이 갱신되어야 합니다");
  console.log(`✅ 2) currentStepIndex=${after.currentStepIndex}, lastEventAt 갱신 확인`);

  const notDue = await advanceAggregateWip("M20", "HBM");
  assert.equal(notDue.advanced, 0, "방금 갱신된 로트는 아직 기한이 안 됐으므로 다시 진행되면 안 됩니다");
  console.log("✅ 3) 기한 전 재호출 시 advanced=0");

  await waferLots.deleteOne({ _id: lotId });

  // 4) packaging 노드 경계를 실제로 넘겨서, createM20PilotWorkOrder(M20_PILOT 워크오더)가 절대 호출되지 않음을 증명한다.
  const { workOrders } = await collections();
  const routeMaster = await getRouteMaster("M20", "HBM");
  assert(routeMaster, "M20/HBM routeMaster가 없습니다");
  const visits = expandRouteMaster(routeMaster);
  const packagingVisit = visits.find((v) => v.operationCode === "MUF_MOLDING_CURE");
  assert(packagingVisit, "routeMaster에 packaging 노드가 없습니다");
  const packagingStepIndex = packagingVisit.stepIndex;
  assert(packagingStepIndex > 0, "packaging 노드가 첫 스텝이면 경계 이전 스텝을 만들 수 없습니다");

  const boundaryLotId = "WLOT:M20:HBM:AGG:test-packaging-boundary";
  await waferLots.deleteOne({ _id: boundaryLotId });
  const boundaryStale = new Date(Date.now() - AUTO_ADVANCE_INTERVAL_MS - 1_000);
  await waferLots.insertOne({
    _id: boundaryLotId, fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-WIP-BOUNDARY",
    status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: packagingStepIndex - 1, currentNodeId: "placeholder",
    lastEventAt: boundaryStale, createdBy: "test", createdAt: boundaryStale, updatedAt: boundaryStale,
  });

  const boundaryResult = await advanceAggregateWip("M20", "HBM");
  assert(boundaryResult.advanced >= 1, "packaging 경계 직전 로트도 진행되어야 합니다");

  const boundaryLot = await waferLots.findOne({ _id: boundaryLotId });
  assert(boundaryLot, "경계 테스트 로트를 찾을 수 없습니다");
  assert.equal(boundaryLot.currentStepIndex, packagingStepIndex, "packaging 스텝으로 진입해야 합니다");
  assert.equal(boundaryLot.currentNodeId, "hbm-muf-molding", "currentNodeId가 P10 MUF/Molding이어야 경계를 실제로 넘은 것입니다");

  const pilotWorkOrderCount = await workOrders.countDocuments({ scope: "M20_PILOT", lotId: boundaryLotId });
  assert.equal(pilotWorkOrderCount, 0, "advanceAggregateWip은 packaging 진입 시에도 M20_PILOT 워크오더를 만들면 안 됩니다");
  console.log(`✅ 4) packaging 경계 통과(step=${boundaryLot.currentStepIndex}, node=${boundaryLot.currentNodeId}) 확인, M20_PILOT 워크오더 생성 0건 확인`);

  await waferLots.deleteOne({ _id: boundaryLotId });
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
