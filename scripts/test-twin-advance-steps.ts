import assert from "node:assert/strict";
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { collections } from "../src/lib/db";
import { advanceAggregateWip } from "../src/lib/lot-route";

async function main() {
  const { waferLots } = await collections();
  const timing = {
    operatingEpochMs: 10 * 86_400_000,
    elapsedOperatingMs: 5 * 60_000,
    recordedAt: new Date("2026-08-22T00:00:00Z"),
  };
  const old = new Date(0);
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  await waferLots.insertMany([
    { _id: ids[0], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-TEST-A",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 0, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: new Date(),
      nextStepOperatingMs: timing.operatingEpochMs - 1 } as never,
    { _id: ids[1], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-TEST-B",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 0, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: new Date(),
      nextStepOperatingMs: timing.operatingEpochMs - 1 } as never,
    { _id: ids[2], fabId: "M20", product: "HBM", routeMasterId: "M20:HBM", foupCode: "FOUP-TEST-FUTURE",
      status: "IN_PROGRESS", cohort: "AGGREGATE", currentStepIndex: 0, waferQty: 25,
      createdBy: "test", createdAt: old, updatedAt: old, lastEventAt: old,
      nextStepOperatingMs: timing.operatingEpochMs + 1 } as never,
  ]);
  try {
    const res = await advanceAggregateWip("M20", "HBM", timing);
    assert.ok("advancedFromStepIndex" in res, "advancedFromStepIndex 반환");
    // 스텝0에서 최소 50웨이퍼(2로트×25) 진행이 집계에 포함
    assert.ok((res.advancedFromStepIndex[0] ?? 0) >= 50, "스텝0 진행 웨이퍼 집계");
    const future = await waferLots.findOne({ _id: ids[2] });
    assert.equal(future?.currentStepIndex, 0, "미래 운영 예정시각은 진행하지 않는다");
  } finally {
    await waferLots.deleteMany({ _id: { $in: ids } });
  }
  console.log("✅ twin advance steps passed");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
