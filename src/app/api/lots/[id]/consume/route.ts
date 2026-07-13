import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { randomUUID } from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { qty, processCode, userId = "system", note } = body as {
    qty: number; processCode?: string; userId?: string; note?: string;
  };

  if (!qty || qty <= 0) return NextResponse.json({ error: "qty 필수" }, { status: 400 });

  const { inventoryLots, inventoryMovements } = await collections();
  const lot = await inventoryLots.findOne({ _id: id });
  if (!lot) return NextResponse.json({ error: "Lot 없음" }, { status: 404 });
  if (lot.availableQuantity < qty) {
    return NextResponse.json({ error: `가용 수량 부족 (가용: ${lot.availableQuantity})` }, { status: 409 });
  }

  const now = new Date();
  const newAvailable = lot.availableQuantity - qty;

  await inventoryLots.updateOne(
    { _id: id },
    {
      $set: {
        availableQuantity: newAvailable,
        qualityStatus: newAvailable === 0 ? "CONSUMED" : lot.qualityStatus,
        updatedAt: now,
      },
    }
  );

  await inventoryMovements.insertOne({
    _id: randomUUID(),
    materialId: lot.materialId,
    type: "ISSUE",
    quantity: qty,
    lotId: id,
    processCode,
    reason: note ?? "수동 출고",
    userId,
    createdAt: now,
  } as never);

  return NextResponse.json({ success: true, remainingAvailable: newAvailable });
}
