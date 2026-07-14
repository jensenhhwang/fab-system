import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const { materialId, lotId, qty } = body as {
    materialId: string;
    lotId: string;
    qty: number;
  };

  if (!materialId || !lotId || !qty || qty <= 0) {
    return NextResponse.json({ error: "materialId, lotId, qty 필수" }, { status: 400 });
  }

  const { workOrders, inventoryLots, inventoryMovements } = await collections();

  const wo = await workOrders.findOne({ _id: id });
  if (!wo) return NextResponse.json({ error: "WO 없음" }, { status: 404 });
  if (wo.status !== "QUEUED" && wo.status !== "MATERIAL_WAIT") {
    return NextResponse.json({ error: "피킹 불가 상태: " + wo.status }, { status: 409 });
  }

  const bomLine = wo.bomLines.find(l => l.materialId === materialId);
  if (!bomLine) return NextResponse.json({ error: "BOM에 없는 자재" }, { status: 400 });

  const lot = await inventoryLots.findOne({ _id: lotId });
  if (!lot) return NextResponse.json({ error: "Lot 없음" }, { status: 404 });
  if (lot.availableQuantity < qty) {
    return NextResponse.json({ error: `가용 수량 부족 (가용: ${lot.availableQuantity})` }, { status: 409 });
  }

  const now = new Date();
  const newAvailable = lot.availableQuantity - qty;

  await inventoryLots.updateOne(
    { _id: lotId },
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
    materialId,
    type: "ISSUE",
    quantity: qty,
    lotId,
    processCode: wo.processCode,
    reason: `MES 피킹: ${id}`,
    userId: "mes-system",
    createdAt: now,
  });

  const updatedBomLines = wo.bomLines.map(line => {
    if (line.materialId !== materialId) return line;
    return {
      ...line,
      actualQty: (line.actualQty ?? 0) + qty,
      pickedLots: [...line.pickedLots, { lotId, qty }],
    };
  });

  const allFulfilled = updatedBomLines.every(
    l => (l.actualQty ?? 0) >= l.plannedQty
  );
  const newStatus = allFulfilled ? "QUEUED" : wo.status;

  await workOrders.updateOne(
    { _id: id },
    { $set: { bomLines: updatedBomLines, status: newStatus, updatedAt: now } }
  );

  return NextResponse.json({
    ok: true,
    remainingAvailable: newAvailable,
    woStatus: newStatus,
    allFulfilled,
  });
}
