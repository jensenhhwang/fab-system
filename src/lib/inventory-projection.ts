import type { ClientSession } from "mongodb";
import { collections } from "@/lib/db";

type Adjustment = { materialId: string; warehouseId: string; quantity: number; session?: ClientSession };

export async function increaseInventoryProjection({ materialId, warehouseId, quantity, session }: Adjustment) {
  const { inventory } = await collections();
  await inventory.updateOne(
    { materialId, warehouseId },
    {
      $inc: { quantity },
      $setOnInsert: { _id: `${materialId}__${warehouseId}`, avgDailyUsage: 0, status: "AVAILABLE" },
    },
    { upsert: true, session },
  );
}

export async function decreaseInventoryProjection({ materialId, warehouseId, quantity, session }: Adjustment) {
  const { inventory } = await collections();
  const result = await inventory.updateOne(
    { materialId, warehouseId, quantity: { $gte: quantity } },
    { $inc: { quantity: -quantity } },
    { session },
  );
  if (!result.modifiedCount) throw new Error("INVENTORY_PROJECTION_INSUFFICIENT");
}

// 창고 재고를 가능한 만큼만 차감하고 부족분을 반환한다(throw 안 함) — 트윈 소모 전용.
export async function burnInventoryProjection({ materialId, warehouseId, quantity, session }: Adjustment): Promise<{ burned: number; shortfall: number }> {
  const { inventory } = await collections();
  const doc = await inventory.findOne({ materialId, warehouseId }, { session });
  const onHand = doc?.quantity ?? 0;
  const burned = Math.min(onHand, quantity);
  const shortfall = quantity - burned;
  if (burned > 0) {
    await inventory.updateOne({ materialId, warehouseId }, { $inc: { quantity: -burned } }, { session });
  }
  return { burned, shortfall };
}
