import "dotenv/config";
import { collections } from "../src/lib/db";

async function main() {
  const { waferLots, waferLotStepEvents, fabScenarios } = await collections();

  await Promise.all([
    waferLots.createIndex({ fabId: 1, product: 1, foupCode: 1, status: 1 }),
    waferLots.createIndex({ fabId: 1, product: 1, cohort: 1, status: 1, lastEventAt: 1 }),
    waferLotStepEvents.createIndex({ lotId: 1, stepIndex: 1 }, { unique: true }),
    // NOTE: intentionally NOT unique. Pre-existing data has 38 duplicate
    // idempotencyKey groups (out of scope for this task to dedupe/fix).
    // This index still accelerates the findOne({ idempotencyKey }) lookup
    // in advanceLotStep (src/lib/lot-route.ts) — that lookup was the actual
    // goal; DB-level uniqueness enforcement is not required for it and is
    // unsafe to add against the current duplicate data.
    waferLotStepEvents.createIndex({ idempotencyKey: 1 }),
  ]);
  console.log("✅ waferLots/waferLotStepEvents 인덱스 생성 완료");

  const now = new Date();
  for (const fab of [{ id: "M20" as const, product: "HBM" as const, utilization: 0.90 }]) {
    await fabScenarios.updateOne(
      { _id: fab.id },
      { $setOnInsert: { _id: fab.id, product: fab.product, utilization: fab.utilization, updatedAt: now, updatedBy: "SYSTEM_SEED" } },
      { upsert: true },
    );
  }
  console.log("✅ fabScenarios M20 초기 시드 완료(이미 있으면 유지)");
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
