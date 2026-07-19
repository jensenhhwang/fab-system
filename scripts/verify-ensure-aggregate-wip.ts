import "dotenv/config";
import assert from "node:assert/strict";
import { collections } from "../src/lib/db";
import { FOUP_WIP_BOOTSTRAP_VERSION, M20_TARGET_OCCUPIED_FOUP } from "../src/lib/foup-wip-model";
import { ensureAggregateWip } from "../src/lib/lot-route";

async function main() {
  const { waferLots, productionCarriers, lotCarrierAssignments } = await collections();
  const legacyFilter = { fabId: "M20" as const, product: "HBM" as const, cohort: "AGGREGATE" as const };
  const modeledFilter = {
    fabId: "M20" as const,
    product: "HBM" as const,
    status: "IN_PROGRESS" as const,
    cohort: { $in: ["WATCHED", "MODELED_FOUP"] as const },
    bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION,
  };
  const before = await Promise.all([
    waferLots.countDocuments(legacyFilter),
    waferLots.countDocuments(modeledFilter),
    productionCarriers.countDocuments({ fabId: "M20", carrierType: "FOUP", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION }),
    lotCarrierAssignments.countDocuments({ fabId: "M20", status: "ACTIVE", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION }),
  ]);

  const first = await ensureAggregateWip("M20", "HBM", "test-script:aggregate-write-guard");
  const second = await ensureAggregateWip("M20", "HBM", "test-script:aggregate-write-guard");
  const after = await Promise.all([
    waferLots.countDocuments(legacyFilter),
    waferLots.countDocuments(modeledFilter),
    productionCarriers.countDocuments({ fabId: "M20", carrierType: "FOUP", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION }),
    lotCarrierAssignments.countDocuments({ fabId: "M20", status: "ACTIVE", bootstrapVersion: FOUP_WIP_BOOTSTRAP_VERSION }),
  ]);

  assert.equal(first.created, 0, "조회 경로에서 legacy AGGREGATE를 생성하면 안 됩니다");
  assert.equal(second.created, 0, "재호출에서도 legacy AGGREGATE를 생성하면 안 됩니다");
  assert.equal(first.targetWip, M20_TARGET_OCCUPIED_FOUP);
  assert.deepEqual(after, before, "ensureAggregateWip 호환 함수는 원장을 변경하면 안 됩니다");
  assert.equal(after[1], M20_TARGET_OCCUPIED_FOUP, "활성 modeled/watched Lot은 14,040개여야 합니다");

  console.log(`✅ aggregate write guard: created=0 · modeled lots=${after[1]} · fleet=${after[2]} · assignments=${after[3]}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
