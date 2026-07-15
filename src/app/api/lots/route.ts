import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { randomUUID } from "crypto";
import { getMongoClient } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const materialId = searchParams.get("materialId") ?? undefined;
  const warehouseId = searchParams.get("warehouseId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;

  const { inventoryLots } = await collections();
  const filter: Record<string, unknown> = {};
  if (materialId) filter.materialId = materialId;
  if (warehouseId) filter.warehouseId = warehouseId;
  if (status) filter.qualityStatus = status;

  const lots = await inventoryLots
    .find(filter)
    .sort({ expiryDate: 1, receivedAt: 1 })
    .toArray();
  return NextResponse.json(lots);
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.inventoryReceipt);
  if (access.error) return access.error;
  const body = await req.json();
  const { materialId, warehouseId, slotId, qty, mfgDate, expiresAt, lotNo } = body as {
    materialId: string; warehouseId: string; slotId?: string;
    qty: number; mfgDate?: string; expiresAt?: string; lotNo?: string;
  };

  if (!materialId || !warehouseId || !qty || qty <= 0) {
    return NextResponse.json({ error: "materialId, warehouseId, qty 필수" }, { status: 400 });
  }

  const { inventoryLots, inventoryMovements } = await collections();
  const now = new Date();
  const id = randomUUID();
  const resolvedLotNo = lotNo ?? `LOT-${materialId}-${Date.now()}`;

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await inventoryLots.insertOne({
    _id: id,
    materialId,
    lotNo: resolvedLotNo,
    quantity: qty,
    availableQuantity: qty,
    receivedAt: now,
    manufactureDate: mfgDate ? new Date(mfgDate) : undefined,
    expiryDate: expiresAt ? new Date(expiresAt) : undefined,
    qualityStatus: "AVAILABLE",
    warehouseId,
    slotId,
    updatedAt: now,
      }, { session });

      await inventoryMovements.insertOne({
    _id: randomUUID(),
    materialId,
    type: "RECEIPT",
    quantity: qty,
    lotId: id,
    reason: "입고 등록",
        userId: access.user.id,
    createdAt: now,
      }, { session });
    });
  } finally {
    await session.endSession();
  }

  return NextResponse.json({ id, lotNo: resolvedLotNo }, { status: 201 });
}
