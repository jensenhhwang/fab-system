import "dotenv/config";
import { randomUUID } from "crypto";
import { collections, getMongoClient } from "../src/lib/db";
import { getInventoryRows } from "../src/lib/queries";
import { calculateScaleUpRequirement, INVENTORY_SCALE_UP_VERSION } from "../src/lib/inventory-scaleup";

const apply = process.argv.includes("--apply");
const rollbackIndex = process.argv.findIndex(arg => arg === "--rollback");
const rollbackBatch = rollbackIndex >= 0 ? process.argv[rollbackIndex + 1] : null;

async function rollback(batchId: string) {
  const { inventory, inventoryMovements, inboundPlans } = await collections();
  const movements = await inventoryMovements.find({ requestId: { $regex: `^${batchId}:` }, type: "ADJUSTMENT" }).toArray();
  if (!movements.length) throw new Error(`복구할 초기 기준 배치를 찾을 수 없습니다: ${batchId}`);
  const client = await getMongoClient();
  const session = client.startSession();
  const now = new Date();
  try {
    await session.withTransaction(async () => {
      for (const movement of movements) {
        const row = await inventory.findOne({ materialId: movement.materialId }, { session });
        if (!row) throw new Error(`${movement.materialId}: 재고 행 누락`);
        await inventory.updateOne({ _id: row._id }, { $inc: { quantity: -movement.quantity }, $set: { updatedAt: now } }, { session });
        await inventoryMovements.insertOne({
          _id: `ROLLBACK-${movement._id}`, materialId: movement.materialId, type: "ADJUSTMENT",
          quantity: -movement.quantity, reason: `초기 재고 스케일업 복구 · ${batchId}`,
          requestId: `ROLLBACK-${batchId}:${movement.materialId}`, userId: "SYSTEM_BASELINE", createdAt: now,
        }, { session });
      }
      const cancelled = await inboundPlans.find({ status: "CANCELLED", cancelReason: `초기 재고 기준 반영 · ${batchId}` }, { session }).toArray();
      for (const plan of cancelled) await inboundPlans.updateOne({ _id: plan._id, status: "CANCELLED" }, {
        $set: { status: "DRAFT", updatedAt: now },
        $unset: { cancelledBy: "", cancelledAt: "", cancelReason: "" },
        $push: { events: { type: "UPDATED", userId: "SYSTEM_BASELINE", at: now, reason: `초기 기준 복구 · ${batchId}` } },
      }, { session });
    });
  } finally { await session.endSession(); }
  console.log(`[opening-scaleup] rollback=${batchId} materials=${movements.length}`);
}

async function main() {
  if (rollbackBatch) return rollback(rollbackBatch);
  const { inventory, inventoryPolicies, inventoryMovements, inboundPlans } = await collections();
  const [rows, policies] = await Promise.all([getInventoryRows(true), inventoryPolicies.find({}).toArray()]);
  const policyMap = new Map(policies.map(policy => [policy.materialId, policy]));
  const uniqueRows = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (uniqueRows.has(row.materialId)) throw new Error(`${row.materialId}: 복수 재고 행은 초기 기준 자동 적용 대상이 아닙니다.`);
    uniqueRows.set(row.materialId, row);
  }
  const proposals = [...uniqueRows.values()].flatMap(row => {
    if (row.material.ropDays <= 0 || row.dailyUsage <= 0) return [];
    const policy = policyMap.get(row.materialId);
    const target = calculateScaleUpRequirement({
      currentQuantity: row.totalQuantity, activeInboundQuantity: 0,
      safetyStock: row.material.safetyStock, dailyUsage: row.dailyUsage,
      policyTargetQuantity: Math.max(policy?.targetQuantity ?? 0, row.dailyUsage * row.material.ropDays),
    });
    return target.replenishmentQuantity > 0 ? [{ row, targetQuantity: target.targetQuantity, delta: target.replenishmentQuantity }] : [];
  });
  console.log(`[opening-scaleup] mode=${apply ? "APPLY" : "DRY-RUN"} materials=${proposals.length} totalDelta=${proposals.reduce((sum, item) => sum + item.delta, 0)}`);
  for (const item of proposals) console.log(`${item.row.material.code}\tcurrent=${item.row.totalQuantity}\ttarget=${item.targetQuantity}\tdelta=${item.delta}\tDOH=${(item.targetQuantity / item.row.dailyUsage).toFixed(1)}`);
  if (!apply || !proposals.length) return;

  const batchId = `OPENING-${new Date().toISOString()}-${randomUUID().slice(0, 6)}`;
  const now = new Date();
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      for (const item of proposals) {
        const result = await inventory.updateOne(
          { _id: item.row.id, quantity: item.row.quantity },
          { $inc: { quantity: item.delta }, $set: { updatedAt: now },
            ...(item.row.capacityLimit ? { $max: { capacityLimit: Math.ceil(item.targetQuantity / 0.68) } } : {}) },
          { session },
        );
        if (!result.modifiedCount) throw new Error(`${item.row.material.code}: 재고가 동시에 변경되었습니다.`);
        await inventoryMovements.insertOne({
          _id: `${batchId}:${item.row.materialId}`, materialId: item.row.materialId, type: "ADJUSTMENT",
          quantity: item.delta, reason: `초기 운영 기준 재고 스케일업 · ${INVENTORY_SCALE_UP_VERSION}`,
          requestId: `${batchId}:${item.row.materialId}`, userId: "SYSTEM_BASELINE", createdAt: now,
        }, { session });
      }
      const planIds = (await inboundPlans.find({ source: "INVENTORY_SCALE_UP", status: "DRAFT" }, { session }).toArray()).map(plan => plan._id);
      for (const planId of planIds) await inboundPlans.updateOne({ _id: planId, status: "DRAFT" }, {
        $set: { status: "CANCELLED", cancelledBy: "SYSTEM_BASELINE", cancelledAt: now,
          cancelReason: `초기 재고 기준 반영 · ${batchId}`, updatedAt: now },
        $push: { events: { type: "CANCELLED", userId: "SYSTEM_BASELINE", at: now, reason: `초기 재고 기준 반영 · ${batchId}` } },
      }, { session });
    });
  } finally { await session.endSession(); }
  console.log(`[opening-scaleup] applied=${proposals.length} batch=${batchId}`);
  console.log(`rollback: npm run db:scale-opening-inventory -- --rollback ${batchId}`);
}

main().catch(error => { console.error(error); process.exit(1); });
