import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { advanceAggregateWip, AUTO_ADVANCE_INTERVAL_MS } from "../src/lib/lot-route";

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
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
