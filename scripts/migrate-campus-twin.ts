import "dotenv/config";
import { collections } from "../src/lib/db";
import { PRODUCT_TO_FAB } from "../src/lib/fab-domain";
import { CAMPUS_FACILITIES, CAMPUS_LAYOUT_VERSION } from "../src/lib/material-flow";

async function main() {
  const {
    facilityNodes, materialAllocations, transferOrders, materialFlowEvents, workOrders,
  } = await collections();
  const now = new Date();

  await Promise.all(CAMPUS_FACILITIES.map((facility) => facilityNodes.updateOne(
    { _id: facility.id },
    {
      $set: {
        code: facility.code,
        name: facility.name,
        role: facility.role,
        ...(facility.fabId ? { fabId: facility.fabId } : {}),
        layoutVersion: CAMPUS_LAYOUT_VERSION,
        position: { x: facility.position[0], y: facility.position[1], z: facility.position[2] },
        active: true,
        updatedAt: now,
      },
    },
    { upsert: true },
  )));

  const backfills = await Promise.all(Object.entries(PRODUCT_TO_FAB).map(([product, fabId]) => (
    workOrders.updateMany({ product: product as keyof typeof PRODUCT_TO_FAB, fabId: { $exists: false } }, { $set: { fabId } })
  )));

  await Promise.all([
    facilityNodes.createIndex({ code: 1 }, { unique: true }),
    facilityNodes.createIndex({ role: 1, fabId: 1, active: 1 }),
    materialAllocations.createIndex({ materialId: 1, fabId: 1, status: 1, updatedAt: -1 }),
    materialAllocations.createIndex({ workOrderId: 1, status: 1 }),
    transferOrders.createIndex({ allocationId: 1, status: 1, updatedAt: -1 }),
    transferOrders.createIndex({ materialId: 1, fabId: 1, status: 1 }),
    transferOrders.createIndex({ status: 1, fromFacilityId: 1, updatedAt: -1 }),
    materialFlowEvents.createIndex({ materialId: 1, fabId: 1, occurredAt: -1 }),
    materialFlowEvents.createIndex({ transferOrderId: 1, occurredAt: 1 }),
    materialFlowEvents.createIndex({ handlingUnitId: 1, occurredAt: -1 }),
  ]);

  const transferVersionBackfill = await transferOrders.updateMany(
    { version: { $exists: false } },
    { $set: { version: 0 } },
  );

  const updatedWorkOrders = backfills.reduce((sum, result) => sum + result.modifiedCount, 0);
  console.log(`✅ Campus Twin 초기화 완료: 시설 ${CAMPUS_FACILITIES.length}개, WorkOrder fabId ${updatedWorkOrders}건, TransferOrder version ${transferVersionBackfill.modifiedCount}건 보정`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
