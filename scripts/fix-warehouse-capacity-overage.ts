import "dotenv/config";
import { randomUUID } from "crypto";
import { collections, getMongoClient } from "../src/lib/db";
import { getWarehouseCapacity } from "../src/lib/queries";

// SPACE 모드 창고(팔레트/슬롯/실린더) 중 점유율이 100%(또는 legalLimit)를 넘는 곳을
// 딱 그 한도까지만 비례 축소한다. TANK_LEVEL(BGY-01/BCY-01)·CONTINUOUS(UPW-01)는
// 점유 계산 방식이 달라(평균 레벨 %) 이 스크립트 대상이 아니며, 이미 100% 미만이다.
// 자재별 환산계수가 어떻든 occupancy = Σ(quantity × factor)는 quantity에 선형이므로,
// 창고 안 모든 자재 수량에 동일한 scale을 곱하면 총점유율도 정확히 같은 비율로 줄어든다.
const TARGET_WAREHOUSES = ["MWH-01", "MWH-02", "HZW-01", "MRO-01", "PRS-01"];
const apply = process.argv.includes("--apply");
const rollbackIndex = process.argv.findIndex((arg) => arg === "--rollback");
const rollbackBatch = rollbackIndex >= 0 ? process.argv[rollbackIndex + 1] : null;

async function rollback(batchId: string) {
  const { inventory, inventoryMovements } = await collections();
  const movements = await inventoryMovements.find({ requestId: { $regex: `^${batchId}:` } }).toArray();
  if (!movements.length) throw new Error(`복구할 배치를 찾을 수 없습니다: ${batchId}`);
  const now = new Date();
  for (const m of movements) {
    await inventory.updateOne(
      { materialId: m.materialId, warehouseId: m.toLocationId ?? undefined },
      { $inc: { quantity: -m.quantity }, $set: { updatedAt: now } },
    );
  }
  await inventoryMovements.insertOne({
    _id: `ROLLBACK-${batchId}`, materialId: "MULTI", type: "ADJUSTMENT",
    quantity: 0, reason: `창고 capacity 비례축소 롤백 · ${batchId} (${movements.length}건)`,
    requestId: `ROLLBACK-${batchId}`, userId: "SYSTEM_BASELINE", createdAt: now,
  });
  console.log(`[fix-warehouse-overage] rollback=${batchId} rows=${movements.length}`);
}

async function main() {
  if (rollbackBatch) return rollback(rollbackBatch);

  const { inventory, inventoryMovements } = await collections();
  const caps = await getWarehouseCapacity();
  const batchId = `WHCAP-FIX-${new Date().toISOString()}-${randomUUID().slice(0, 6)}`;
  const now = new Date();
  let totalRows = 0;

  for (const code of TARGET_WAREHOUSES) {
    const wh = caps.find((w) => w.code === code);
    if (!wh) continue;
    const target = wh.legalLimit != null ? Math.min(wh.totalCapacity, wh.legalLimit) : wh.totalCapacity;
    if (wh.occupancy <= target) {
      console.log(`${code}: occupancy=${wh.occupancy} <= target=${target} — 축소 불필요`);
      continue;
    }
    const scale = target / wh.occupancy;
    console.log(`${code}: occupancy=${wh.occupancy} target=${target} scale=${scale.toFixed(4)}`);

    const rows = await inventory.find({ warehouseId: wh.id }).toArray();
    for (const row of rows) {
      const delta = row.quantity * scale - row.quantity; // 음수
      if (Math.abs(delta) < 1e-6) continue;
      console.log(`  ${row.materialId}\tcurrent=${row.quantity.toLocaleString()}\tnew=${(row.quantity + delta).toLocaleString()}\tdelta=${delta.toLocaleString()}`);
      totalRows++;
      if (!apply) continue;
      const result = await inventory.updateOne(
        { _id: row._id, quantity: row.quantity },
        { $inc: { quantity: delta }, $set: { updatedAt: now } },
      );
      if (!result.modifiedCount) throw new Error(`${row._id}: 재고가 동시에 변경되었습니다 — 다시 시도하세요.`);
      await inventoryMovements.insertOne({
        _id: `${batchId}:${row._id}`, materialId: row.materialId, type: "ADJUSTMENT",
        quantity: delta, toLocationId: wh.id,
        reason: `창고 capacity 초과분 비례 축소 · ${code} 100% 목표 · ${batchId}`,
        requestId: `${batchId}:${row._id}`, userId: "SYSTEM_BASELINE", createdAt: now,
      });
    }
  }

  console.log(`[fix-warehouse-overage] mode=${apply ? "APPLY" : "DRY-RUN"} rows=${totalRows}`);
  if (apply) {
    console.log(`[fix-warehouse-overage] applied batch=${batchId}`);
    console.log(`rollback: npx tsx scripts/fix-warehouse-capacity-overage.ts --rollback ${batchId}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
