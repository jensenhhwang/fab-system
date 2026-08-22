import "dotenv/config";
import { randomUUID } from "crypto";
import { collections, getMongoClient } from "../src/lib/db";

// 2026-07-28·08-02·08-03 세 차례에 걸쳐 PKG-LBD-001(HBM4 Logic Base Die KGD)이 순간(주문→입고
// 1분 이내)으로 수천만~1억 단위 발주를 받은 잔재고를 정상 기준으로 되돌린다. avgDailyBurn은
// 그때 이미 0으로 리셋됐지만(다른 오염 정리), 이미 입고된 물량 자체는 그대로 남아 MWH-02
// 점유율을 868%까지 밀어올렸다. avgDailyUsage(2026-07-26 OPERATIONAL_REALISM_V1 검증값, 이번
// 폭주와 무관하게 그대로 보존됨) × ropDays를 정상 목표로 삼는다.
const MATERIAL_ID = "PKG-LBD-001";
const WAREHOUSE_ID = "MWH-02";
const apply = process.argv.includes("--apply");
const rollbackIndex = process.argv.findIndex((arg) => arg === "--rollback");
const rollbackBatch = rollbackIndex >= 0 ? process.argv[rollbackIndex + 1] : null;

async function rollback(batchId: string) {
  const { inventory, inventoryMovements } = await collections();
  const movement = await inventoryMovements.findOne({ _id: batchId });
  if (!movement) throw new Error(`복구할 배치를 찾을 수 없습니다: ${batchId}`);
  const now = new Date();
  await inventory.updateOne(
    { materialId: movement.materialId, warehouseId: WAREHOUSE_ID },
    { $inc: { quantity: -movement.quantity }, $set: { updatedAt: now } },
  );
  await inventoryMovements.insertOne({
    _id: `ROLLBACK-${batchId}`, materialId: movement.materialId, type: "ADJUSTMENT",
    quantity: -movement.quantity, reason: `PKG-LBD-001 폭주 재고 보정 롤백 · ${batchId}`,
    requestId: `ROLLBACK-${batchId}`, userId: "SYSTEM_BASELINE", createdAt: now,
  });
  console.log(`[fix-pkg-lbd-001] rollback=${batchId} delta=${-movement.quantity}`);
}

async function main() {
  if (rollbackBatch) return rollback(rollbackBatch);

  const { inventory, materials, inventoryMovements } = await collections();
  const [inv, mat] = await Promise.all([
    inventory.findOne({ materialId: MATERIAL_ID, warehouseId: WAREHOUSE_ID }),
    materials.findOne({ _id: MATERIAL_ID }),
  ]);
  if (!inv || !mat) throw new Error("PKG-LBD-001 재고/자재 마스터를 찾을 수 없습니다.");

  const dailyUsage = inv.avgDailyUsage ?? 0;
  const target = Math.round(dailyUsage * mat.ropDays);
  const current = inv.quantity;
  const delta = target - current;

  console.log(`[fix-pkg-lbd-001] mode=${apply ? "APPLY" : "DRY-RUN"}`);
  console.log(`current=${current.toLocaleString()} dailyUsage=${dailyUsage.toLocaleString()} ropDays=${mat.ropDays} target=${target.toLocaleString()} delta=${delta.toLocaleString()}`);

  if (delta >= 0) {
    console.log("현재 재고가 이미 목표 이하입니다 — 보정할 필요가 없습니다.");
    return;
  }
  if (!apply) return;

  const batchId = `PKGLBD001-FIX-${new Date().toISOString()}-${randomUUID().slice(0, 6)}`;
  const now = new Date();
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const result = await inventory.updateOne(
        { materialId: MATERIAL_ID, warehouseId: WAREHOUSE_ID, quantity: current },
        { $inc: { quantity: delta }, $set: { updatedAt: now } },
        { session },
      );
      if (!result.modifiedCount) throw new Error("재고가 동시에 변경되었습니다 — 다시 시도하세요.");
      await inventoryMovements.insertOne({
        _id: batchId, materialId: MATERIAL_ID, type: "ADJUSTMENT",
        quantity: delta, reason: "PKG-LBD-001 폭주 발주 잔재고 정상화 (07-28/08-02/08-03 순간 대량입고 보정)",
        requestId: batchId, userId: "SYSTEM_BASELINE", createdAt: now,
      }, { session });
    });
  } finally {
    await session.endSession();
  }
  console.log(`[fix-pkg-lbd-001] applied batch=${batchId} newQuantity=${target.toLocaleString()}`);
  console.log(`rollback: npx tsx scripts/fix-pkg-lbd-001-runaway-inventory.ts --rollback ${batchId}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
