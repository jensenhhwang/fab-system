import "dotenv/config";
import { randomUUID } from "crypto";
import { collections, getMongoClient } from "../src/lib/db";
import { m20MaterialDemandForScenario, M20_MATERIAL_CONSUMPTION } from "../src/lib/material-consumption";

// avgDailyBurn EMA 오염(수정 완료)이 남긴 잔여 초과재고를 정리한다. 이번엔 창고 capacity에
// 비례해서 깎는 게 아니라(그건 지난번에도 임시방편이었다) 설계기준 ROP 목표(dailyDemand×ropDays)
// 로 직접 맞춘다 — 신호(avgDailyBurn) 자체가 이미 고쳐졌으니 이번엔 다시 안 불어난다.
const apply = process.argv.includes("--apply");

async function main() {
  const { inventory, materials, inventoryMovements } = await collections();
  const demand = new Map(m20MaterialDemandForScenario("NORMAL").map((d) => [d.materialId, d.monthlyQty / 30]));
  const materialIds = [...new Set(M20_MATERIAL_CONSUMPTION.map((r) => r.materialId))];
  const matById = new Map((await materials.find({ _id: { $in: materialIds } }).toArray()).map((m) => [m._id, m]));

  const batchId = `TRIM-DESIGN-${new Date().toISOString()}-${randomUUID().slice(0, 6)}`;
  const now = new Date();
  let totalDelta = 0;
  const client = await getMongoClient();

  for (const materialId of materialIds) {
    const mat = matById.get(materialId);
    if (!mat) continue;
    const dailyDemand = demand.get(materialId) ?? 0;
    const target = dailyDemand * mat.ropDays;
    const rows = await inventory.find({ materialId }).toArray();
    for (const row of rows) {
      if (row.quantity <= target) continue; // 부족한 건 안 건드림(발주가 알아서 채움)
      const delta = target - row.quantity; // 음수
      totalDelta += delta;
      console.log(`${mat.code}\tcurrent=${row.quantity.toFixed(0)}\ttarget=${target.toFixed(0)}\tdelta=${delta.toFixed(0)}`);
      if (!apply) continue;
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const result = await inventory.updateOne(
            { _id: row._id, quantity: row.quantity },
            { $inc: { quantity: delta }, $set: { updatedAt: now } },
            { session },
          );
          if (!result.modifiedCount) throw new Error(`${row._id}: 재고가 동시에 변경되었습니다.`);
          await inventoryMovements.insertOne({
            _id: `${batchId}:${row._id}`, materialId, type: "ADJUSTMENT", quantity: delta,
            reason: `avgDailyBurn EMA 오염 잔여 초과재고 설계기준 트리밍 · ${batchId}`,
            requestId: `${batchId}:${row._id}`, userId: "SYSTEM_BASELINE", createdAt: now,
          }, { session });
        });
      } finally {
        await session.endSession();
      }
    }
  }
  console.log(`[trim-inventory] mode=${apply ? "APPLY" : "DRY-RUN"} totalDelta=${totalDelta.toFixed(0)}`);
  if (apply) console.log(`rollback 필요시 inventoryMovements(${batchId}) 참고해 역방향 조정하세요.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
