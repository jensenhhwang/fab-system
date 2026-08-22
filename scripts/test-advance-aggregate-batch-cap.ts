import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { collections } from "../src/lib/db";
import { advanceAggregateWip, AUTO_ADVANCE_INTERVAL_MS } from "../src/lib/lot-route";
import { M20_TARGET_OCCUPIED_FOUP } from "../src/lib/foup-wip-model";

// 회귀 배경: releaseAggregateWip가 상시 만재고(14,040)를 유지하기 시작하면서, tick 간격(5s)과
// AUTO_ADVANCE_INTERVAL_MS(5s)가 같아 매 tick 전체 재고가 동시에 "due"가 된다. 그런데
// AGGREGATE_ADVANCE_BATCH_MAX가 2,000이라 86%가 매 tick 밀리며 특정 스텝 구간에 뭉치는 버그가
// 실제로 관측됨(Day-N 발견, "M20이 전부 cell array에 뭉쳐있다"). 배치 상한이 목표 재고를
// 감당해야 한다.
const BATCH_TEST_SIZE = M20_TARGET_OCCUPIED_FOUP > 2_000 ? 2_500 : 100;

async function main() {
  const { waferLots } = await collections();
  const prefix = `WLOT:TEST:BATCHCAP:${randomUUID()}`;
  const staleTime = new Date(Date.now() - AUTO_ADVANCE_INTERVAL_MS - 1_000);
  const docs = Array.from({ length: BATCH_TEST_SIZE }, (_, i) => ({
    _id: `${prefix}:${i}`, fabId: "M20" as const, product: "HBM" as const,
    routeMasterId: "M20:HBM", foupCode: `FOUP-WIP-BATCHTEST-${i}`,
    status: "IN_PROGRESS" as const, cohort: "AGGREGATE" as const, currentStepIndex: 5, currentNodeId: "placeholder",
    lastEventAt: staleTime, createdBy: "test", createdAt: staleTime, updatedAt: staleTime,
  }));
  await waferLots.insertMany(docs);

  try {
    const result = await advanceAggregateWip("M20", "HBM");
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
