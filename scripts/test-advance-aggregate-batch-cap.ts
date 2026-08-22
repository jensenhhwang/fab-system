import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { collections } from "../src/lib/db";
import { advanceAggregateWip } from "../src/lib/lot-route";
import { M20_TARGET_OCCUPIED_FOUP } from "../src/lib/foup-wip-model";

// 회귀 배경: releaseAggregateWip가 상시 만재고(14,040)를 유지하기 시작하면서, tick 간격(5s)과
// 운영 예정시각이 같은 로트가 목표 WIP만큼 있어도 배치 상한이 전부 처리할 수 있어야 한다.
const BATCH_TEST_SIZE = M20_TARGET_OCCUPIED_FOUP > 2_000 ? 2_500 : 100;

async function main() {
  const { waferLots } = await collections();
  const prefix = `WLOT:TEST:BATCHCAP:${randomUUID()}`;
  const timing = {
    operatingEpochMs: 10 * 86_400_000,
    elapsedOperatingMs: 5 * 60_000,
    recordedAt: new Date("2026-08-22T00:00:00Z"),
  };
  const staleTime = new Date(0);
  const docs = Array.from({ length: BATCH_TEST_SIZE }, (_, i) => ({
    _id: `${prefix}:${i}`, fabId: "M20" as const, product: "HBM" as const,
    routeMasterId: "M20:HBM", foupCode: `FOUP-WIP-BATCHTEST-${i}`,
    status: "IN_PROGRESS" as const, cohort: "AGGREGATE" as const, currentStepIndex: 5, currentNodeId: "placeholder",
    lastEventAt: new Date(), createdBy: "test", createdAt: staleTime, updatedAt: staleTime,
    nextStepOperatingMs: timing.operatingEpochMs - 1,
  }));
  await waferLots.insertMany(docs);

  try {
    const result = await advanceAggregateWip("M20", "HBM", timing);
    assert(
      result.advanced >= BATCH_TEST_SIZE,
      `배치 상한이 목표 재고(${M20_TARGET_OCCUPIED_FOUP})보다 작으면 due 로트가 한 tick에 다 못 밀린다 (advanced=${result.advanced}, expected>=${BATCH_TEST_SIZE})`,
    );
    console.log(`✅ AGGREGATE_ADVANCE_BATCH_MAX가 ${BATCH_TEST_SIZE}개 동시 due를 한 tick에 전부 처리했다 (advanced=${result.advanced})`);
  } finally {
    await waferLots.deleteMany({ _id: { $regex: `^${prefix}` } });
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
