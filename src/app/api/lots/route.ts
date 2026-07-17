import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { randomUUID } from "crypto";
import { getMongoClient } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { increaseInventoryProjection } from "@/lib/inventory-projection";

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
  const { materialId, warehouseId, slotId, qty, mfgDate, expiresAt, lotNo, inboundPlanId, requestId } = body as {
    materialId: string; warehouseId: string; slotId?: string;
    qty: number; mfgDate?: string; expiresAt?: string; lotNo?: string;
    inboundPlanId?: string; requestId?: string;
  };

  if (!materialId || !warehouseId || !Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "materialId, warehouseId, qty 필수" }, { status: 400 });
  }
  if (inboundPlanId && !requestId) {
    return NextResponse.json({ error: "계획 입고에는 중복 방지 요청 ID가 필요합니다." }, { status: 400 });
  }

  const { inventoryLots, inventoryMovements, inboundPlans, materials, warehouses } = await collections();
  const now = new Date();
  const id = randomUUID();
  const resolvedLotNo = lotNo ?? `LOT-${materialId}-${Date.now()}`;
  const movementId = requestId ? `RECEIPT-${requestId}` : randomUUID();

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const duplicate = requestId ? await inventoryMovements.findOne({ _id: movementId }, { session }) : null;
      if (duplicate?.lotId) {
        const existingLot = await inventoryLots.findOne({ _id: duplicate.lotId }, { session });
        return { id: duplicate.lotId, lotNo: existingLot?.lotNo ?? "", duplicate: true };
      }

      const [material, warehouse] = await Promise.all([
        materials.findOne({ _id: materialId }, { session }),
        warehouses.findOne({ _id: warehouseId }, { session }),
      ]);
      if (!material || !warehouse) throw new ReceiptError("자재 또는 시설을 찾을 수 없습니다.", 404);

      if (inboundPlanId) {
        const plan = await inboundPlans.findOne({ _id: inboundPlanId }, { session });
        if (!plan) throw new ReceiptError("입고계획을 찾을 수 없습니다.", 404);
        if (plan.status !== "CONFIRMED") throw new ReceiptError("확정 상태의 입고계획만 사용할 수 있습니다.", 409);
        if (plan.materialId !== materialId) throw new ReceiptError("입고 자재가 계획 자재와 일치하지 않습니다.", 400);
        if (qty > plan.remainingQuantity) throw new ReceiptError(`잔여 계획수량 ${plan.remainingQuantity} ${plan.unit}을 초과할 수 없습니다.`, 409);

        const rawRemaining = plan.remainingQuantity - qty;
        const remainingQuantity = Math.abs(rawRemaining) < 1e-9 ? 0 : rawRemaining;
        const planUpdate = await inboundPlans.updateOne(
          { _id: inboundPlanId, status: "CONFIRMED", remainingQuantity: plan.remainingQuantity },
          {
            $inc: { receivedQuantity: qty },
            $set: { remainingQuantity, status: remainingQuantity === 0 ? "COMPLETED" : "CONFIRMED", updatedAt: now,
              ...(remainingQuantity === 0 ? { completedAt: now } : {}) },
            $push: { events: { type: "RECEIVED", userId: access.user.id, at: now, receiptId: movementId, quantity: qty } },
          },
          { session },
        );
        if (!planUpdate.modifiedCount) throw new ReceiptError("계획이 동시에 변경되었습니다. 새로고침 후 다시 시도해주세요.", 409);
      }

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
        inboundPlanId,
        updatedAt: now,
      }, { session });

      await inventoryMovements.insertOne({
        _id: movementId,
        materialId,
        type: "RECEIPT",
        quantity: qty,
        lotId: id,
        inboundPlanId,
        requestId,
        reason: inboundPlanId ? "입고계획 연결 입고" : "입고 등록",
        userId: access.user.id,
        createdAt: now,
      }, { session });
      await increaseInventoryProjection({ materialId, warehouseId, quantity: qty, session });
      return { id, lotNo: resolvedLotNo, duplicate: false };
    });
    return NextResponse.json(result ?? { id, lotNo: resolvedLotNo }, { status: result?.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof ReceiptError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (requestId && isDuplicateKeyError(error)) {
      const movement = await inventoryMovements.findOne({ _id: movementId });
      const lot = movement?.lotId ? await inventoryLots.findOne({ _id: movement.lotId }) : null;
      if (movement?.lotId) return NextResponse.json({ id: movement.lotId, lotNo: lot?.lotNo ?? "", duplicate: true });
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

class ReceiptError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
