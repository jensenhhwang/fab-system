import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { randomUUID } from "crypto";
import { getMongoClient } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { decreaseInventoryProjection } from "@/lib/inventory-projection";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireRole(WRITE_ROLES.inventoryIssue);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json();
  const { qty, processCode, note } = body as {
    qty: number; processCode?: string; note?: string;
  };

  if (!qty || qty <= 0) return NextResponse.json({ error: "qty 필수" }, { status: 400 });

  const { inventoryLots, inventoryMovements } = await collections();
  const now = new Date();
  const client = await getMongoClient();
  const session = client.startSession();
  let remainingAvailable = 0;
  try {
    await session.withTransaction(async () => {
      const lot = await inventoryLots.findOneAndUpdate(
        { _id: id, qualityStatus: "AVAILABLE", availableQuantity: { $gte: qty } },
        { $inc: { availableQuantity: -qty }, $set: { updatedAt: now } },
        { returnDocument: "after", session },
      );
      if (!lot) throw new Error("INSUFFICIENT_LOT");
      if (!lot.warehouseId) throw new Error("LOT_WAREHOUSE_MISSING");
      remainingAvailable = lot.availableQuantity;
      if (remainingAvailable === 0) {
        await inventoryLots.updateOne({ _id: id }, { $set: { qualityStatus: "CONSUMED" } }, { session });
      }
      await inventoryMovements.insertOne({
        _id: randomUUID(), materialId: lot.materialId, type: "ISSUE", quantity: qty,
        lotId: id, processCode, reason: note ?? "수동 출고", userId: access.user.id, createdAt: now,
      }, { session });
      await decreaseInventoryProjection({ materialId: lot.materialId, warehouseId: lot.warehouseId, quantity: qty, session });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_LOT") {
      return NextResponse.json({ error: "Lot 없음, 출고 불가 상태 또는 가용 수량 부족" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "INVENTORY_PROJECTION_INSUFFICIENT") {
      return NextResponse.json({ error: "집계 현재고가 부족해 출고할 수 없습니다. 재고 정합성 점검이 필요합니다." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "LOT_WAREHOUSE_MISSING") {
      return NextResponse.json({ error: "Lot의 보관 시설 정보가 없어 출고할 수 없습니다." }, { status: 409 });
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return NextResponse.json({ success: true, remainingAvailable });
}
