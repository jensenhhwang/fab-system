import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { randomUUID } from "crypto";
import { getMongoClient } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireRole(WRITE_ROLES.workOrderPick);
  if (access.error) return access.error;
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

  const now = new Date();
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

  const client = await getMongoClient();
  const session = client.startSession();
  let newAvailable = 0;
  try {
    await session.withTransaction(async () => {
      const lot = await inventoryLots.findOneAndUpdate(
        { _id: lotId, materialId, qualityStatus: "AVAILABLE", availableQuantity: { $gte: qty } },
        { $inc: { availableQuantity: -qty }, $set: { updatedAt: now } },
        { returnDocument: "after", session },
      );
      if (!lot) throw new Error("INSUFFICIENT_LOT");
      newAvailable = lot.availableQuantity;
      if (newAvailable === 0) {
        await inventoryLots.updateOne({ _id: lotId }, { $set: { qualityStatus: "CONSUMED" } }, { session });
      }
      await inventoryMovements.insertOne({
        _id: randomUUID(), materialId, type: "ISSUE", quantity: qty, lotId,
        processCode: wo.processCode, reason: `MES 피킹: ${id}`, userId: access.user.id, createdAt: now,
      }, { session });
      const result = await workOrders.updateOne(
        { _id: id, status: wo.status, bomLines: wo.bomLines },
        { $set: { bomLines: updatedBomLines, status: newStatus, updatedAt: now } },
        { session },
      );
      if (!result.modifiedCount) throw new Error("WORK_ORDER_CHANGED");
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INSUFFICIENT_LOT") {
      return NextResponse.json({ error: "Lot 없음, 피킹 불가 상태 또는 가용 수량 부족" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "WORK_ORDER_CHANGED") {
      return NextResponse.json({ error: "작업지시가 이미 변경되었습니다. 새로고침 후 다시 시도하세요." }, { status: 409 });
    }
    throw error;
  } finally {
    await session.endSession();
  }

  return NextResponse.json({
    ok: true,
    remainingAvailable: newAvailable,
    woStatus: newStatus,
    allFulfilled,
  });
}
