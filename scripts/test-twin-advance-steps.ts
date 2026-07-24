import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { advanceAggregateWip } from "../src/lib/lot-route";

async function main() {
  const { waferLots } = await collections();
  // 과거 lastEventAt으로 즉시 진행 대상이 되는 AGGREGATE 테스트 로트 2개 삽입
  const old = new Date(Date.now() - 60_000);
  const ids = [randomUUID(), randomUUID()];
  await waferLots.insertMany([
    { _id: ids[0], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-TEST-A",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 0, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never,
    { _id: ids[1], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-TEST-B",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 0, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old } as never,
  ]);
  try {
    const res = await advanceAggregateWip("M20", "HBM");
    assert.ok("advancedFromStepIndex" in res, "advancedFromStepIndex 반환");
    // 스텝0에서 최소 50웨이퍼(2로트×25) 진행이 집계에 포함
    assert.ok((res.advancedFromStepIndex[0] ?? 0) >= 50, "스텝0 진행 웨이퍼 집계");
  } finally {
    await waferLots.deleteMany({ _id: { $in: ids } });
  }
  console.log("✅ twin advance steps passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
