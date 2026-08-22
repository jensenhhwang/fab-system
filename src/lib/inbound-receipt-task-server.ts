import { createHash } from "crypto";
import type { Collection } from "mongodb";
import { collections, getDb, getMongoClient, type InboundPlanDoc } from "@/lib/db";
import {
  inboundReceiptTaskId,
  parseDateOnly,
  seoulDateKey,
  type InboundReceiptAutomationStateDoc,
  type InboundReceiptTaskDoc,
  type PhysicalReceiptConfirmation,
} from "@/lib/inbound-receipt-tasks";
import {
  InventoryReceiptError,
  receiveInventoryInSession,
} from "@/lib/inventory-receipt-service";

type TaskCollections = {
  tasks: Collection<InboundReceiptTaskDoc>;
  state: Collection<InboundReceiptAutomationStateDoc>;
};

async function taskCollections(): Promise<TaskCollections> {
  const db = await getDb();
  return {
    tasks: db.collection<InboundReceiptTaskDoc>("inboundReceiptTasks"),
    state: db.collection<InboundReceiptAutomationStateDoc>("inboundReceiptAutomationState"),
  };
}

export class InboundReceiptTaskError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function ensureInboundReceiptTaskIndexes(): Promise<void> {
  const { tasks } = await taskCollections();
  await Promise.all([
    tasks.createIndex({ inboundPlanId: 1, sequence: 1 }, { unique: true }),
    tasks.createIndex({ status: 1, updatedAt: -1 }),
  ]);
}

async function getOrInitAutomationState(now: Date): Promise<InboundReceiptAutomationStateDoc> {
  const { state } = await taskCollections();
  const initial: InboundReceiptAutomationStateDoc = {
    _id: "singleton",
    cutoverDateKey: seoulDateKey(now),
    createdAt: now,
  };
  await state.updateOne({ _id: "singleton" }, { $setOnInsert: initial }, { upsert: true });
  return (await state.findOne({ _id: "singleton" })) ?? initial;
}

function createTaskDoc(plan: InboundPlanDoc, sequence: number, quantity: number, now: Date): InboundReceiptTaskDoc {
  const status = "AWAITING_PHYSICAL_CONFIRMATION" as const;
  return {
    _id: inboundReceiptTaskId(plan._id, sequence),
    inboundPlanId: plan._id,
    planNo: plan.planNo,
    sequence,
    materialId: plan.materialId,
    unit: plan.unit,
    plannedDate: plan.plannedDate,
    expectedQuantity: quantity,
    status,
    version: 1,
    events: [{
      type: "ETA_DUE",
      actorRole: "SYSTEM",
      actorId: "INBOUND_RECEIPT_SCHEDULER",
      at: now,
      toStatus: status,
      quantity,
      message: `도착 예정일이 되어 박물류의 실물 확인을 기다립니다.`,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

export async function materializeDueInboundReceiptTasks(now: Date = new Date()): Promise<{ created: number; scanned: number }> {
  const automation = await getOrInitAutomationState(now);
  const { inboundPlans } = await collections();
  const { tasks, state } = await taskCollections();
  const todayKey = seoulDateKey(now);
  const plans = await inboundPlans.find({
    status: "CONFIRMED",
    remainingQuantity: { $gt: 0 },
    plannedDate: {
      $gte: new Date(`${automation.cutoverDateKey}T00:00:00.000Z`),
      $lte: new Date(`${todayKey}T00:00:00.000Z`),
    },
  }).sort({ plannedDate: 1 }).toArray();

  let created = 0;
  for (const plan of plans) {
    const latest = await tasks.findOne({ inboundPlanId: plan._id }, { sort: { sequence: -1 } });
    if (latest && latest.status !== "RECONCILED" && latest.status !== "CANCELLED") continue;
    const sequence = (latest?.sequence ?? 0) + 1;
    try {
      await tasks.insertOne(createTaskDoc(plan, sequence, plan.remainingQuantity, now));
      created++;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }
  await state.updateOne({ _id: "singleton" }, { $set: { lastScanAt: now } });
  return { created, scanned: plans.length };
}

export async function listInboundReceiptTasks(): Promise<InboundReceiptTaskDoc[]> {
  const { tasks } = await taskCollections();
  return tasks.find({}).sort({ updatedAt: -1 }).limit(100).toArray();
}

type PhysicalConfirmationInput = {
  taskId: string;
  actorId: string;
  body: unknown;
};

function physicalRequestHash(value: Omit<PhysicalReceiptConfirmation, "confirmedBy" | "confirmedAt" | "requestHash">): string {
  return createHash("sha256").update(JSON.stringify({
    ...value,
    manufactureDate: value.manufactureDate?.toISOString() ?? null,
    expiryDate: value.expiryDate?.toISOString() ?? null,
  })).digest("hex");
}

function parsePhysicalBody(body: unknown) {
  if (!body || typeof body !== "object") {
    throw new InboundReceiptTaskError("JSON 요청 본문이 필요합니다.", 400, "INVALID_BODY");
  }
  const value = body as Record<string, unknown>;
  const version = Number(value.version);
  const quantity = Number(value.quantity);
  const warehouseId = String(value.warehouseId ?? "").trim();
  const slotId = String(value.slotId ?? "").trim() || undefined;
  const lotNo = String(value.lotNo ?? "").trim();
  const requestId = String(value.requestId ?? "").trim();
  if (!Number.isInteger(version) || version < 1) throw new InboundReceiptTaskError("올바른 업무 버전이 필요합니다.", 400, "INVALID_VERSION");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new InboundReceiptTaskError("실물 수량은 0보다 커야 합니다.", 400, "INVALID_QUANTITY");
  if (!warehouseId || !lotNo || !requestId) throw new InboundReceiptTaskError("시설, Lot 번호, 요청 ID가 필요합니다.", 400, "REQUIRED_FIELD_MISSING");
  let manufactureDate: Date | undefined;
  let expiryDate: Date | undefined;
  try {
    manufactureDate = parseDateOnly(value.manufactureDate, "제조일");
    expiryDate = parseDateOnly(value.expiryDate, "유효기간");
  } catch (error) {
    throw new InboundReceiptTaskError(error instanceof Error ? error.message : "날짜가 올바르지 않습니다.", 400, "INVALID_DATE");
  }
  if (manufactureDate && expiryDate && manufactureDate > expiryDate) {
    throw new InboundReceiptTaskError("유효기간은 제조일보다 빠를 수 없습니다.", 400, "INVALID_DATE_ORDER");
  }
  return { version, quantity, warehouseId, slotId, lotNo, requestId, manufactureDate, expiryDate };
}

export async function confirmPhysicalReceipt(input: PhysicalConfirmationInput): Promise<{ task: InboundReceiptTaskDoc; duplicate: boolean }> {
  const parsed = parsePhysicalBody(input.body);
  const { tasks } = await taskCollections();
  const { inboundPlans, warehouses, storageLocations } = await collections();
  const task = await tasks.findOne({ _id: input.taskId });
  if (!task) throw new InboundReceiptTaskError("입고 업무를 찾을 수 없습니다.", 404, "TASK_NOT_FOUND");

  const requestShape = {
    quantity: parsed.quantity,
    warehouseId: parsed.warehouseId,
    slotId: parsed.slotId,
    lotNo: parsed.lotNo,
    manufactureDate: parsed.manufactureDate,
    expiryDate: parsed.expiryDate,
    requestId: parsed.requestId,
  };
  const requestHash = physicalRequestHash(requestShape);
  if (task.physicalConfirmation?.requestId === parsed.requestId) {
    if (task.physicalConfirmation.requestHash !== requestHash) {
      throw new InboundReceiptTaskError("같은 요청 ID를 다른 확인 내용에 재사용할 수 없습니다.", 409, "REQUEST_ID_REUSED");
    }
    return { task, duplicate: true };
  }
  if (task.status !== "AWAITING_PHYSICAL_CONFIRMATION") {
    throw new InboundReceiptTaskError("실물 확인을 받을 수 있는 상태가 아닙니다.", 409, "INVALID_TASK_STATUS");
  }
  if (task.version !== parsed.version) {
    throw new InboundReceiptTaskError("업무가 변경되었습니다. 새로고침 후 다시 시도해주세요.", 409, "TASK_VERSION_CONFLICT");
  }

  const [plan, warehouse] = await Promise.all([
    inboundPlans.findOne({ _id: task.inboundPlanId }),
    warehouses.findOne({ _id: parsed.warehouseId }),
  ]);
  if (!plan) throw new InboundReceiptTaskError("입고계획을 찾을 수 없습니다.", 404, "PLAN_NOT_FOUND");
  if (plan.status !== "CONFIRMED" || plan.remainingQuantity <= 0) {
    throw new InboundReceiptTaskError("입고계획이 더 이상 실행 가능한 상태가 아닙니다.", 409, "PLAN_NOT_CONFIRMED");
  }
  if (parsed.quantity > plan.remainingQuantity) {
    throw new InboundReceiptTaskError(`잔여 계획수량 ${plan.remainingQuantity} ${plan.unit}을 초과할 수 없습니다.`, 409, "PLAN_QUANTITY_EXCEEDED");
  }
  if (!warehouse) throw new InboundReceiptTaskError("입고 시설을 찾을 수 없습니다.", 404, "WAREHOUSE_NOT_FOUND");
  if (parsed.slotId) {
    const slot = await storageLocations.findOne({
      warehouseId: parsed.warehouseId,
      $or: [{ _id: parsed.slotId }, { code: parsed.slotId }],
    });
    if (!slot) throw new InboundReceiptTaskError("선택한 슬롯이 입고 시설에 속하지 않습니다.", 400, "INVALID_STORAGE_LOCATION");
  }

  const now = new Date();
  const confirmation: PhysicalReceiptConfirmation = {
    ...requestShape,
    confirmedBy: input.actorId,
    confirmedAt: now,
    requestHash,
  };
  const result = await tasks.updateOne(
    { _id: task._id, status: "AWAITING_PHYSICAL_CONFIRMATION", version: parsed.version },
    {
      $set: { status: "AWAITING_RECONCILIATION", physicalConfirmation: confirmation, updatedAt: now },
      $inc: { version: 1 },
      $push: { events: {
        type: "PHYSICAL_CONFIRMED",
        actorRole: "LOGISTICS",
        actorId: input.actorId,
        at: now,
        fromStatus: "AWAITING_PHYSICAL_CONFIRMATION",
        toStatus: "AWAITING_RECONCILIATION",
        quantity: parsed.quantity,
        requestId: parsed.requestId,
        message: `박물류가 실물 ${parsed.quantity} ${task.unit}과 Lot ${parsed.lotNo}를 확인했습니다.`,
      } },
    },
  );
  if (!result.modifiedCount) throw new InboundReceiptTaskError("업무가 동시에 변경되었습니다.", 409, "TASK_VERSION_CONFLICT");
  const updated = await tasks.findOne({ _id: task._id });
  if (!updated) throw new InboundReceiptTaskError("갱신된 업무를 찾을 수 없습니다.", 500, "TASK_UPDATE_LOST");
  return { task: updated, duplicate: false };
}

export async function reconcileInboundReceipt(input: {
  taskId: string;
  actorId: string;
  body: unknown;
}): Promise<{ task: InboundReceiptTaskDoc; duplicate: boolean }> {
  if (!input.body || typeof input.body !== "object") {
    throw new InboundReceiptTaskError("JSON 요청 본문이 필요합니다.", 400, "INVALID_BODY");
  }
  const body = input.body as Record<string, unknown>;
  const version = Number(body.version);
  const requestId = String(body.requestId ?? "").trim();
  if (!Number.isInteger(version) || version < 1 || !requestId) {
    throw new InboundReceiptTaskError("올바른 업무 버전과 요청 ID가 필요합니다.", 400, "INVALID_RECONCILIATION_INPUT");
  }

  const { tasks } = await taskCollections();
  const existing = await tasks.findOne({ _id: input.taskId });
  if (!existing) throw new InboundReceiptTaskError("입고 업무를 찾을 수 없습니다.", 404, "TASK_NOT_FOUND");
  if (existing.reconciliation?.requestId === requestId) return { task: existing, duplicate: true };
  if (existing.status !== "AWAITING_RECONCILIATION" || !existing.physicalConfirmation) {
    throw new InboundReceiptTaskError("정합 검증을 실행할 수 있는 상태가 아닙니다.", 409, "INVALID_TASK_STATUS");
  }
  if (existing.version !== version) {
    throw new InboundReceiptTaskError("업무가 변경되었습니다. 새로고침 후 다시 시도해주세요.", 409, "TASK_VERSION_CONFLICT");
  }

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const task = await tasks.findOne({ _id: input.taskId }, { session });
      if (!task || task.status !== "AWAITING_RECONCILIATION" || task.version !== version || !task.physicalConfirmation) {
        throw new InboundReceiptTaskError("업무가 동시에 변경되었습니다.", 409, "TASK_VERSION_CONFLICT");
      }
      const confirmation = task.physicalConfirmation;
      let receipt;
      try {
        receipt = await receiveInventoryInSession({
          materialId: task.materialId,
          warehouseId: confirmation.warehouseId,
          slotId: confirmation.slotId,
          quantity: confirmation.quantity,
          manufactureDate: confirmation.manufactureDate,
          expiryDate: confirmation.expiryDate,
          lotNo: confirmation.lotNo,
          inboundPlanId: task.inboundPlanId,
          requestId: `TASK:${task._id}`,
          actorId: input.actorId,
          reason: "박물류 실물 확인 후 이자재 정합 검증 완료",
        }, session);
      } catch (error) {
        if (error instanceof InventoryReceiptError) {
          throw new InboundReceiptTaskError(error.message, error.status, error.code);
        }
        throw error;
      }

      const now = new Date();
      const updated = await tasks.updateOne(
        { _id: task._id, status: "AWAITING_RECONCILIATION", version },
        {
          $set: {
            status: "RECONCILED",
            reconciliation: {
              lotId: receipt.lotId,
              movementId: receipt.movementId,
              reconciledBy: input.actorId,
              reconciledAt: now,
              requestId,
            },
            updatedAt: now,
          },
          $inc: { version: 1 },
          $push: { events: {
            type: "RECONCILED",
            actorRole: "MATERIALS",
            actorId: input.actorId,
            at: now,
            fromStatus: "AWAITING_RECONCILIATION",
            toStatus: "RECONCILED",
            quantity: confirmation.quantity,
            requestId,
            message: `이자재가 계획 잔량과 Lot을 검증하고 ${confirmation.quantity} ${task.unit}을 재고에 반영했습니다.`,
          } },
        },
        { session },
      );
      if (!updated.modifiedCount) throw new InboundReceiptTaskError("업무가 동시에 변경되었습니다.", 409, "TASK_VERSION_CONFLICT");

      const { inboundPlans } = await collections();
      const planAfter = await inboundPlans.findOne({ _id: task.inboundPlanId }, { session });
      if (planAfter?.status === "CONFIRMED" && planAfter.remainingQuantity > 0) {
        const next = createTaskDoc(planAfter, task.sequence + 1, planAfter.remainingQuantity, now);
        await tasks.updateOne({ _id: next._id }, { $setOnInsert: next }, { upsert: true, session });
      }
      return tasks.findOne({ _id: task._id }, { session });
    });
    if (!result) throw new InboundReceiptTaskError("정합 처리 결과를 찾을 수 없습니다.", 500, "EMPTY_TRANSACTION_RESULT");
    return { task: result, duplicate: false };
  } finally {
    await session.endSession();
  }
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
