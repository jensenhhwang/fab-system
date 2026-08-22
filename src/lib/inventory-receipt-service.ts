import { createHash, randomUUID } from "crypto";
import type { ClientSession } from "mongodb";
import { collections, getMongoClient } from "@/lib/db";
import { increaseInventoryProjection } from "@/lib/inventory-projection";

export type InventoryReceiptInput = {
  materialId: string;
  warehouseId: string;
  slotId?: string;
  quantity: number;
  manufactureDate?: Date;
  expiryDate?: Date;
  lotNo?: string;
  inboundPlanId?: string;
  requestId?: string;
  actorId: string;
  reason?: string;
};

export type InventoryReceiptResult = {
  lotId: string;
  lotNo: string;
  movementId: string;
  duplicate: boolean;
};

export class InventoryReceiptError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function receiptHash(input: InventoryReceiptInput): string {
  return createHash("sha256").update(JSON.stringify({
    materialId: input.materialId,
    warehouseId: input.warehouseId,
    slotId: input.slotId ?? null,
    quantity: input.quantity,
    manufactureDate: input.manufactureDate?.toISOString() ?? null,
    expiryDate: input.expiryDate?.toISOString() ?? null,
    lotNo: input.lotNo ?? null,
    inboundPlanId: input.inboundPlanId ?? null,
  })).digest("hex");
}

function validateDates(input: InventoryReceiptInput): void {
  if (input.manufactureDate && Number.isNaN(input.manufactureDate.getTime())) {
    throw new InventoryReceiptError("제조일이 올바르지 않습니다.", 400, "INVALID_MANUFACTURE_DATE");
  }
  if (input.expiryDate && Number.isNaN(input.expiryDate.getTime())) {
    throw new InventoryReceiptError("유효기간이 올바르지 않습니다.", 400, "INVALID_EXPIRY_DATE");
  }
  if (input.manufactureDate && input.expiryDate && input.manufactureDate > input.expiryDate) {
    throw new InventoryReceiptError("유효기간은 제조일보다 빠를 수 없습니다.", 400, "INVALID_DATE_ORDER");
  }
}

export async function receiveInventoryInSession(
  input: InventoryReceiptInput,
  session: ClientSession,
): Promise<InventoryReceiptResult> {
  if (!input.materialId || !input.warehouseId || !Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new InventoryReceiptError("자재, 시설, 0보다 큰 수량이 필요합니다.", 400, "INVALID_RECEIPT_INPUT");
  }
  if (input.inboundPlanId && !input.requestId) {
    throw new InventoryReceiptError("계획 입고에는 중복 방지 요청 ID가 필요합니다.", 400, "REQUEST_ID_REQUIRED");
  }
  validateDates(input);

  const {
    inventoryLots, inventoryMovements, inboundPlans, materials, warehouses, storageLocations,
  } = await collections();
  const now = new Date();
  const lotId = randomUUID();
  const resolvedLotNo = input.lotNo?.trim() || `LOT-${input.materialId}-${Date.now()}`;
  const movementId = input.requestId ? `RECEIPT-${input.requestId}` : randomUUID();
  const requestHash = receiptHash(input);

  const duplicate = input.requestId
    ? await inventoryMovements.findOne({ _id: movementId }, { session })
    : null;
  if (duplicate?.lotId) {
    if (duplicate.requestHash && duplicate.requestHash !== requestHash) {
      throw new InventoryReceiptError("같은 요청 ID를 다른 입고 내용에 재사용할 수 없습니다.", 409, "REQUEST_ID_REUSED");
    }
    const existingLot = await inventoryLots.findOne({ _id: duplicate.lotId }, { session });
    return {
      lotId: duplicate.lotId,
      lotNo: existingLot?.lotNo ?? "",
      movementId,
      duplicate: true,
    };
  }

  const [material, warehouse] = await Promise.all([
    materials.findOne({ _id: input.materialId }, { session }),
    warehouses.findOne({ _id: input.warehouseId }, { session }),
  ]);
  if (!material || !warehouse) {
    throw new InventoryReceiptError("자재 또는 시설을 찾을 수 없습니다.", 404, "MASTER_NOT_FOUND");
  }

  let resolvedSlotId = input.slotId;
  if (input.slotId) {
    const slot = await storageLocations.findOne({
      warehouseId: input.warehouseId,
      $or: [{ _id: input.slotId }, { code: input.slotId }],
    }, { session });
    if (!slot) {
      throw new InventoryReceiptError("선택한 슬롯이 입고 시설에 속하지 않습니다.", 400, "INVALID_STORAGE_LOCATION");
    }
    resolvedSlotId = slot._id;
  }

  if (input.inboundPlanId) {
    const plan = await inboundPlans.findOne({ _id: input.inboundPlanId }, { session });
    if (!plan) throw new InventoryReceiptError("입고계획을 찾을 수 없습니다.", 404, "PLAN_NOT_FOUND");
    if (plan.status !== "CONFIRMED") {
      throw new InventoryReceiptError("확정 상태의 입고계획만 사용할 수 있습니다.", 409, "PLAN_NOT_CONFIRMED");
    }
    if (plan.materialId !== input.materialId) {
      throw new InventoryReceiptError("입고 자재가 계획 자재와 일치하지 않습니다.", 400, "PLAN_MATERIAL_MISMATCH");
    }
    if (input.quantity > plan.remainingQuantity) {
      throw new InventoryReceiptError(
        `잔여 계획수량 ${plan.remainingQuantity} ${plan.unit}을 초과할 수 없습니다.`,
        409,
        "PLAN_QUANTITY_EXCEEDED",
      );
    }

    const rawRemaining = plan.remainingQuantity - input.quantity;
    const remainingQuantity = Math.abs(rawRemaining) < 1e-9 ? 0 : rawRemaining;
    const planUpdate = await inboundPlans.updateOne(
      { _id: plan._id, status: "CONFIRMED", remainingQuantity: plan.remainingQuantity },
      {
        $inc: { receivedQuantity: input.quantity },
        $set: {
          remainingQuantity,
          status: remainingQuantity === 0 ? "COMPLETED" : "CONFIRMED",
          updatedAt: now,
          ...(remainingQuantity === 0 ? { completedAt: now } : {}),
        },
        $push: {
          events: {
            type: "RECEIVED",
            userId: input.actorId,
            at: now,
            receiptId: movementId,
            quantity: input.quantity,
          },
        },
      },
      { session },
    );
    if (!planUpdate.modifiedCount) {
      throw new InventoryReceiptError("계획이 동시에 변경되었습니다. 새로고침 후 다시 시도해주세요.", 409, "PLAN_VERSION_CONFLICT");
    }
  }

  await inventoryLots.insertOne({
    _id: lotId,
    materialId: input.materialId,
    lotNo: resolvedLotNo,
    quantity: input.quantity,
    availableQuantity: input.quantity,
    receivedAt: now,
    manufactureDate: input.manufactureDate,
    expiryDate: input.expiryDate,
    qualityStatus: "AVAILABLE",
    warehouseId: input.warehouseId,
    slotId: resolvedSlotId,
    inboundPlanId: input.inboundPlanId,
    updatedAt: now,
  }, { session });

  await inventoryMovements.insertOne({
    _id: movementId,
    materialId: input.materialId,
    type: "RECEIPT",
    quantity: input.quantity,
    lotId,
    inboundPlanId: input.inboundPlanId,
    requestId: input.requestId,
    requestHash,
    reason: input.reason ?? (input.inboundPlanId ? "담당자 정합 검증 완료 입고" : "입고 등록"),
    userId: input.actorId,
    createdAt: now,
  }, { session });
  await increaseInventoryProjection({
    materialId: input.materialId,
    warehouseId: input.warehouseId,
    quantity: input.quantity,
    session,
  });

  return { lotId, lotNo: resolvedLotNo, movementId, duplicate: false };
}

export async function receiveInventory(input: InventoryReceiptInput): Promise<InventoryReceiptResult> {
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    const result = await session.withTransaction(() => receiveInventoryInSession(input, session));
    if (!result) throw new InventoryReceiptError("입고 트랜잭션 결과가 없습니다.", 500, "EMPTY_TRANSACTION_RESULT");
    return result;
  } catch (error) {
    if (input.requestId && isDuplicateKeyError(error)) {
      const { inventoryMovements, inventoryLots } = await collections();
      const movement = await inventoryMovements.findOne({ _id: `RECEIPT-${input.requestId}` });
      const lot = movement?.lotId ? await inventoryLots.findOne({ _id: movement.lotId }) : null;
      if (movement?.lotId) {
        const hash = receiptHash(input);
        if (movement.requestHash && movement.requestHash !== hash) {
          throw new InventoryReceiptError("같은 요청 ID를 다른 입고 내용에 재사용할 수 없습니다.", 409, "REQUEST_ID_REUSED");
        }
        return { lotId: movement.lotId, lotNo: lot?.lotNo ?? "", movementId: movement._id, duplicate: true };
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
