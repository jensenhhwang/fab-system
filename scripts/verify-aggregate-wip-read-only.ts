import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { getAggregateWipSummary } from "../src/lib/lot-route";

async function main() {
  const { waferLots } = await collections();
  const filter = { fabId: "M20" as const, product: "HBM" as const };
  const before = await waferLots.countDocuments(filter);
  const first = await getAggregateWipSummary("M20", "HBM");
  const second = await getAggregateWipSummary("M20", "HBM");
  const after = await waferLots.countDocuments(filter);

  assert.equal(after, before, "WIP GET 집계는 waferLots를 생성·진행·삭제하면 안 됩니다.");
  assert.deepEqual(second, first, "연속 조회 사이에 WIP 집계가 변경되면 안 됩니다.");
  assert.equal(first.currentWip, first.aggregateWip + first.visualWip, "VISUAL과 AGGREGATE 집계 계약이 어긋났습니다.");
  assert.equal(first.unit, "FOUP_EQUIVALENT");
  console.log(`✅ AGGREGATE WIP read-only: target=${first.targetWip}, current=${first.currentWip}, aggregate=${first.aggregateWip}, visual=${first.visualWip}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
