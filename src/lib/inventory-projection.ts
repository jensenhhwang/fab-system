import "server-only";

import type { ClientSession } from "mongodb";
import { collections } from "@/lib/db";

type Adjustment = { materialId: string; warehouseId: string; quantity: number; session: ClientSession };

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
