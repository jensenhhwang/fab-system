import { randomUUID } from "crypto";
import { collections, getMongoClient } from "@/lib/db";
import type {
  AgentDecisionDoc,
  AgentRole,
  AgentRoleMode,
  AgentRunDoc,
  BomLine,
  EquipmentAssignmentDoc,
  MaterialAllocationDoc,
  MaterialFlowEventDoc,
  PurchaseOrderDraftDoc,
  TransferOrderDoc,
  WorkOrderDoc,
} from "@/lib/db";
import {
  calculateM20Procurement,
  M20_AGENT_POLICY_VERSION,
} from "@/lib/m20-agent-policy";

const runIdFor = (workOrderId: string) => `M20:${workOrderId}`;
const decisionId = (key: string) => `DECISION:${key}`;

async function recordDecision(input: Omit<AgentDecisionDoc, "_id" | "createdAt">) {
  const { agentDecisions } = await collections();
  const doc: AgentDecisionDoc = { _id: decisionId(input.idempotencyKey), ...input, createdAt: new Date() };
  await agentDecisions.updateOne(
    { idempotencyKey: input.idempotencyKey },
    { $setOnInsert: doc },
    { upsert: true },
  );
}

async function getRoleModes(): Promise<Record<AgentRole, AgentRoleMode>> {
  const { agentRoleModes } = await collections();
  const docs = await agentRoleModes.find({}).toArray();
  const modes: Record<AgentRole, AgentRoleMode> = { PROCUREMENT: "AGENT", WMS: "AGENT", MES: "AGENT", PROCESS: "AGENT" };
  for (const doc of docs) modes[doc._id] = doc.mode;
  return modes;
}

export async function getAgentRoleModes() {
  return getRoleModes();
}

export async function setAgentRoleMode(role: AgentRole, mode: AgentRoleMode, actorId: string) {
  const { agentRoleModes } = await collections();
  const now = new Date();
  await agentRoleModes.updateOne(
    { _id: role },
    { $set: { mode, updatedBy: actorId, updatedAt: now }, $setOnInsert: { _id: role } },
    { upsert: true },
  );
  return agentRoleModes.findOne({ _id: role });
}

async function getProcurementPolicy(fabId: WorkOrderDoc["fabId"], materialId: string) {
  const { agentPolicies } = await collections();
  return agentPolicies.findOne({ _id: `${fabId}:${materialId}` });
}

export async function reserveM20PilotMaterial(input: {
  workOrderId: string;
  actorId: string;
  requestId?: string;
}) {
  const commandId = input.requestId ?? `AGENT:WMS:RESERVE:${input.workOrderId}`;
  const {
    workOrders, inventoryLots, handlingUnits, materialAllocations,
    transferOrders, materialFlowEvents,
  } = await collections();
  const existing = await materialFlowEvents.findOne({ requestId: commandId });
  if (existing) return { ok: true as const, idempotent: true, transferOrderId: existing.transferOrderId };

  const wo = await workOrders.findOne({ _id: input.workOrderId });
  if (!wo || wo.scope !== "M20_PILOT" || wo.fabId !== "M20") throw new Error("M20 대표 작업지시가 아닙니다.");
  const line = wo.bomLines[0];
  if (!line) throw new Error("M20 대표 BOM이 없습니다.");
  const allocation = await materialAllocations.findOne({
    workOrderId: wo._id, materialId: line.materialId, status: { $in: ["PLANNED", "RESERVED"] },
  });
  if (!allocation) throw new Error("활성 Allocation이 없습니다.");
  const transfer = await transferOrders.findOne({ allocationId: allocation._id, status: { $in: ["CREATED", "PICKING"] } });
  if (!transfer) throw new Error("예약 가능한 TransferOrder가 없습니다.");
  if (transfer.handlingUnitId && transfer.lotId) {
    return { ok: true as const, idempotent: true, transferOrderId: transfer._id, lotId: transfer.lotId, handlingUnitId: transfer.handlingUnitId };
  }

  const quantity = line.plannedQty;
  const lots = await inventoryLots.find({
    materialId: line.materialId,
    qualityStatus: "AVAILABLE",
    availableQuantity: { $gte: quantity },
    simulated: { $ne: true },
  }).sort({ expiryDate: 1, receivedAt: 1 }).limit(30).toArray();
  let lot = null;
  let handlingUnit = null;
  for (const candidate of lots) {
    const unit = await handlingUnits.findOne({
      inventoryLotId: candidate._id,
      materialId: line.materialId,
      status: "AVAILABLE",
      quantity,
      $or: [{ logisticsStatus: "STORED" }, { logisticsStatus: { $exists: false } }],
    });
    if (unit) { lot = candidate; handlingUnit = unit; break; }
  }
  if (!lot?.warehouseId || !handlingUnit) throw new Error(`FEFO 기준 정확히 ${quantity}${allocation.unit}인 가용 HU가 없습니다.`);
  const warehouseId = lot.warehouseId;

  const now = new Date();
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const lotResult = await inventoryLots.updateOne(
        { _id: lot!._id, qualityStatus: "AVAILABLE", availableQuantity: { $gte: quantity } },
        { $inc: { availableQuantity: -quantity }, $set: { updatedAt: now } },
        { session },
      );
      if (!lotResult.modifiedCount) throw new Error("AGENT_LOT_CHANGED");
      const versionFilter = handlingUnit!.version === undefined ? { version: { $exists: false } } : { version: handlingUnit!.version };
      const huResult = await handlingUnits.updateOne(
        { _id: handlingUnit!._id, status: "AVAILABLE", ...versionFilter, $or: [{ logisticsStatus: "STORED" }, { logisticsStatus: { $exists: false } }] },
        { $set: {
          logisticsStatus: "RESERVED",
          currentFacilityId: warehouseId,
          currentLocationId: handlingUnit!.currentLocationId ?? handlingUnit!.locationId,
          reservedWorkOrderId: wo._id,
          reservedTransferOrderId: transfer._id,
          version: (handlingUnit!.version ?? 0) + 1,
          updatedAt: now,
        } },
        { session },
      );
      if (!huResult.modifiedCount) throw new Error("AGENT_HU_CHANGED");
      await materialAllocations.updateOne(
        { _id: allocation._id, status: allocation.status },
        { $set: { status: "RESERVED", inventoryLotIds: [lot!._id], sourceFacilityId: warehouseId, updatedAt: now } },
        { session },
      );
      const transferVersionFilter = transfer.version === undefined ? { version: { $exists: false } } : { version: transfer.version };
      const transferResult = await transferOrders.updateOne(
        { _id: transfer._id, status: transfer.status, ...transferVersionFilter },
        { $set: {
          status: "PICKING",
          fromFacilityId: warehouseId,
          fromLocationId: handlingUnit!.currentLocationId ?? handlingUnit!.locationId,
          lotId: lot!._id,
          handlingUnitId: handlingUnit!._id,
          version: (transfer.version ?? 0) + 1,
          updatedAt: now,
        } },
        { session },
      );
      if (!transferResult.modifiedCount) throw new Error("AGENT_TRANSFER_CHANGED");
      await materialFlowEvents.insertOne({
        _id: randomUUID(), materialId: line.materialId, fabId: wo.fabId,
        type: "PICKING_STARTED", quantity, unit: allocation.unit, facilityId: warehouseId,
        locationId: handlingUnit!.currentLocationId ?? handlingUnit!.locationId,
        allocationId: allocation._id, transferOrderId: transfer._id, workOrderId: wo._id,
        processCode: wo.processCode, lotId: lot!._id, handlingUnitId: handlingUnit!._id,
        requestId: commandId, sequence: 2, occurredAt: now, recordedBy: `WMS_AGENT:${input.actorId}`,
      }, { session });
    });
  } finally {
    await session.endSession();
  }
  return { ok: true as const, transferOrderId: transfer._id, lotId: lot._id, handlingUnitId: handlingUnit._id };
}

async function holdProcurementAgent(wo: WorkOrderDoc, traceId: string) {
  const { purchaseOrderDrafts } = await collections();
  const line = wo.bomLines[0];
  const existingPo = await purchaseOrderDrafts.findOne({ sourceWorkOrderId: wo._id, materialId: line.materialId, policyVersion: M20_AGENT_POLICY_VERSION });
  await recordDecision({
    runId: runIdFor(wo._id), workOrderId: wo._id, traceId, agentRole: "PROCUREMENT",
    policyVersion: M20_AGENT_POLICY_VERSION, inputSnapshot: { materialId: line.materialId, fabId: wo.fabId },
    reasonCodes: ["HUMAN_MODE_ACTIVE"], proposedAction: "MANUAL_PROCUREMENT_REQUIRED",
    result: "HUMAN_MODE_HOLD", idempotencyKey: `${runIdFor(wo._id)}:PROCUREMENT:HOLD`,
  });
  return existingPo;
}

async function runProcurementAgent(wo: WorkOrderDoc, traceId: string, actorId: string) {
  const {
    materials, inventory, materialAllocations, inboundPlans, materialSuppliers,
    purchaseOrderDrafts,
  } = await collections();
  const line = wo.bomLines[0];
  const key = `${runIdFor(wo._id)}:PROCUREMENT:${M20_AGENT_POLICY_VERSION}`;
  const policy = await getProcurementPolicy(wo.fabId, line.materialId);
  if (!policy) {
    await recordDecision({
      runId: runIdFor(wo._id), workOrderId: wo._id, traceId, agentRole: "PROCUREMENT",
      policyVersion: M20_AGENT_POLICY_VERSION, inputSnapshot: { materialId: line.materialId, fabId: wo.fabId },
      reasonCodes: ["POLICY_NOT_CONFIGURED"], proposedAction: "BLOCK_PURCHASE_DRAFT",
      result: "BLOCKED", idempotencyKey: key,
    });
    return null;
  }
  const [material, inventoryRows, reservations, confirmedInbound, approvedSupplier, existingPo] = await Promise.all([
    materials.findOne({ _id: line.materialId }),
    inventory.find({ materialId: line.materialId, status: { $nin: ["HOLD", "QUARANTINE", "CONSUMED"] } }).toArray(),
    materialAllocations.aggregate<{ quantity: number }>([
      { $match: { materialId: line.materialId, status: { $in: ["PLANNED", "RESERVED", "RELEASED"] } } },
      { $group: { _id: null, quantity: { $sum: "$quantity" } } },
    ]).next(),
    inboundPlans.aggregate<{ quantity: number }>([
      { $match: { materialId: line.materialId, status: "CONFIRMED" } },
      { $group: { _id: null, quantity: { $sum: "$remainingQuantity" } } },
    ]).next(),
    materialSuppliers.findOne({
      materialId: line.materialId,
      supplierId: policy.supplierId,
      qualificationStatus: "APPROVED",
    }),
    purchaseOrderDrafts.findOne({ sourceWorkOrderId: wo._id, materialId: line.materialId, policyVersion: M20_AGENT_POLICY_VERSION }),
  ]);
  const onHand = inventoryRows.reduce((sum, row) => sum + row.quantity, 0);
  const dailyUsage = inventoryRows.reduce((sum, row) => sum + row.avgDailyUsage, 0);
  const calculation = calculateM20Procurement({
    onHand,
    activeReservations: reservations?.quantity ?? 0,
    confirmedInbound: confirmedInbound?.quantity ?? 0,
    safetyStock: material?.safetyStock ?? 0,
    dailyUsage,
    leadTimeDays: policy.leadTimeDays,
    moq: policy.moq,
    orderMultiple: policy.orderMultiple,
  });
  if (!approvedSupplier) {
    await recordDecision({
      runId: runIdFor(wo._id), workOrderId: wo._id, traceId, agentRole: "PROCUREMENT",
      policyVersion: M20_AGENT_POLICY_VERSION, inputSnapshot: { ...calculation, supplierId: policy.supplierId },
      reasonCodes: ["APPROVED_SUPPLIER_MASTER_MISSING"], proposedAction: "BLOCK_PURCHASE_DRAFT",
      result: "BLOCKED", idempotencyKey: key,
    });
    return null;
  }
  if (calculation.quantity <= 0) {
    await recordDecision({
      runId: runIdFor(wo._id), workOrderId: wo._id, traceId, agentRole: "PROCUREMENT",
      policyVersion: M20_AGENT_POLICY_VERSION, inputSnapshot: calculation,
      reasonCodes: ["PROJECTED_STOCK_SUFFICIENT"], proposedAction: "NO_PURCHASE_ORDER",
      result: "NO_ACTION", idempotencyKey: key,
    });
    return existingPo;
  }
  const now = new Date();
  const po: PurchaseOrderDraftDoc = existingPo ?? {
    _id: `PO:${wo._id}:${line.materialId}`,
    poNo: `PO-${wo.fabId}-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${wo._id.slice(-8).toUpperCase()}`,
    sourceWorkOrderId: wo._id,
    agentRunId: runIdFor(wo._id),
    materialId: line.materialId,
    supplierId: approvedSupplier.supplierId,
    quantity: calculation.quantity,
    unit: material?.unit ?? "kg",
    unitPrice: policy.unitPrice,
    currency: policy.currency,
    moq: policy.moq,
    orderMultiple: policy.orderMultiple,
    leadTimeDays: policy.leadTimeDays,
    expectedDate: new Date(now.getTime() + policy.leadTimeDays * 86_400_000),
    status: "PENDING_APPROVAL",
    policyVersion: M20_AGENT_POLICY_VERSION,
    calculation: {
      onHand,
      activeReservations: reservations?.quantity ?? 0,
      confirmedInbound: confirmedInbound?.quantity ?? 0,
      ...calculation,
    },
    createdBy: `PROCUREMENT_AGENT:${actorId}`,
    createdAt: now,
    updatedAt: now,
  };
  await purchaseOrderDrafts.updateOne(
    { _id: po._id },
    { $setOnInsert: po },
    { upsert: true },
  );
  await recordDecision({
    runId: runIdFor(wo._id), workOrderId: wo._id, traceId, agentRole: "PROCUREMENT",
    policyVersion: M20_AGENT_POLICY_VERSION,
    inputSnapshot: { ...po.calculation, moq: po.moq, orderMultiple: po.orderMultiple, supplierId: po.supplierId },
    reasonCodes: ["LEAD_TIME_COVERAGE_SHORTAGE", "MOQ_MULTIPLE_APPLIED", "HUMAN_APPROVAL_REQUIRED"],
    proposedAction: `CREATE_PO_DRAFT:${po.poNo}`, result: "WAITING_APPROVAL", idempotencyKey: key,
  });
  return po;
}

async function releaseMesAndAssignEquipment(wo: WorkOrderDoc, traceId: string) {
  const { equipmentMaster, equipmentAssignments, workOrders } = await collections();
  const existing = await equipmentAssignments.findOne({ workOrderId: wo._id, status: { $in: ["RESERVED", "ACTIVE", "COMPLETED"] } });
  if (existing) return existing;
  const occupied = await equipmentAssignments.distinct("equipmentId", { status: { $in: ["RESERVED", "ACTIVE"] } });
  const equipmentFilter = {
    fabId: wo.fabId,
    processCode: wo.processCode,
    status: { $in: ["RUN", "IDLE"] },
    _id: { $nin: occupied },
  } as const;
  const equipment = await equipmentMaster.findOne(
    { ...equipmentFilter, source: "MES_MASTER" }, { sort: { oee: -1, _id: 1 } },
  ) ?? await equipmentMaster.findOne(
    { ...equipmentFilter, source: "MODELED_BASELINE" }, { sort: { oee: -1, _id: 1 } },
  );
  const mesKey = `${runIdFor(wo._id)}:MES:RELEASE`;
  const processKey = `${runIdFor(wo._id)}:PROCESS:ASSIGN`;
  if (!equipment) {
    await recordDecision({
      runId: runIdFor(wo._id), workOrderId: wo._id, traceId, agentRole: "MES",
      policyVersion: M20_AGENT_POLICY_VERSION, inputSnapshot: { fabId: wo.fabId, processCode: wo.processCode },
      reasonCodes: ["NO_AVAILABLE_EQUIPMENT"], proposedAction: "BLOCK_WO_RELEASE", result: "BLOCKED", idempotencyKey: mesKey,
    });
    return null;
  }
  const assignment: EquipmentAssignmentDoc = {
    _id: `EQA:${wo._id}`,
    workOrderId: wo._id,
    equipmentId: equipment._id,
    fabId: wo.fabId,
    processCode: wo.processCode,
    plannedLoad: wo.plannedQty,
    capacityUnit: equipment.capacityUnit,
    capacitySource: equipment.source,
    status: "RESERVED",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await equipmentAssignments.insertOne(assignment, { session });
      const released = await workOrders.updateOne(
        { _id: wo._id, status: "MATERIAL_WAIT" },
        { $set: { status: "QUEUED", updatedAt: new Date() } },
        { session },
      );
      if (!released.modifiedCount) throw new Error("WO_RELEASE_CHANGED");
    });
  } finally {
    await session.endSession();
  }
  await recordDecision({
    runId: runIdFor(wo._id), workOrderId: wo._id, traceId, agentRole: "PROCESS",
    policyVersion: M20_AGENT_POLICY_VERSION,
    inputSnapshot: { equipmentId: equipment._id, status: equipment.status, ratedCapacity: equipment.ratedCapacity, oee: equipment.oee, source: equipment.source },
    reasonCodes: [equipment.source === "MODELED_BASELINE" ? "MODELED_CAPACITY_GATE" : "MES_MASTER_CAPACITY_GATE", "EQUIPMENT_EXCLUSIVE_RESERVATION"],
    proposedAction: `RESERVE_EQUIPMENT:${equipment._id}`, result: "AUTO_EXECUTED", idempotencyKey: processKey,
  });
  await recordDecision({
    runId: runIdFor(wo._id), workOrderId: wo._id, traceId, agentRole: "MES",
    policyVersion: M20_AGENT_POLICY_VERSION,
    inputSnapshot: { allocationStatus: "RELEASED", equipmentAssignmentId: assignment._id },
    reasonCodes: ["LINE_SIDE_READY", "CAPACITY_AVAILABLE"],
    proposedAction: "RELEASE_WORK_ORDER", result: "AUTO_EXECUTED", idempotencyKey: mesKey,
  });
  return assignment;
}

export async function orchestrateM20Agents(
  workOrderId: string,
  actorId: string,
  options: { trigger?: "AUTO" | "MANUAL" } = {},
) {
  const trigger = options.trigger ?? "AUTO";
  const {
    workOrders, transferOrders, materialFlowEvents, agentRuns,
    materialAllocations, equipmentAssignments,
  } = await collections();
  let wo = await workOrders.findOne({ _id: workOrderId });
  if (!wo || wo.scope !== "M20_PILOT" || wo.fabId !== "M20") throw new Error("M20 대표 작업지시가 아닙니다.");
  let transfer = await transferOrders.findOne({ workOrderId: wo._id }, { sort: { createdAt: 1 } });
  if (!transfer) throw new Error("M20 TransferOrder가 없습니다.");
  const runId = runIdFor(wo._id);
  const now = new Date();
  await agentRuns.updateOne(
    { _id: runId },
    { $setOnInsert: {
      _id: runId, workOrderId: wo._id, fabId: wo.fabId, traceId: transfer._id,
      status: "OPEN", stage: "CREATED", policyVersion: M20_AGENT_POLICY_VERSION,
      createdBy: actorId, createdAt: now, updatedAt: now,
    } },
    { upsert: true },
  );

  const roleModes = await getRoleModes();

  const purchaseOrder = roleModes.PROCUREMENT === "HUMAN" && trigger === "AUTO"
    ? await holdProcurementAgent(wo, transfer._id)
    : await runProcurementAgent(wo, transfer._id, actorId);

  if (transfer.status === "CREATED") {
    if (roleModes.WMS === "HUMAN" && trigger === "AUTO") {
      await recordDecision({
        runId, workOrderId: wo._id, traceId: transfer._id, agentRole: "WMS",
        policyVersion: M20_AGENT_POLICY_VERSION,
        inputSnapshot: { materialId: transfer.materialId, quantity: transfer.quantity },
        reasonCodes: ["HUMAN_MODE_ACTIVE"], proposedAction: "MANUAL_RESERVE_REQUIRED",
        result: "HUMAN_MODE_HOLD", idempotencyKey: `${runId}:WMS:HOLD`,
      });
      await agentRuns.updateOne({ _id: runId }, { $set: {
        status: "HUMAN_MODE_HOLD", stage: "CREATED", nextHumanAction: "WMS_MANUAL_RUN",
        blockedReason: "WMS 담당이 HUMAN 모드입니다. 담당자가 직접 재고를 예약해야 합니다.",
        lastTrigger: trigger, updatedAt: new Date(),
      } });
      return getM20AgentSnapshot(workOrderId);
    }
    try {
      const reservation = await reserveM20PilotMaterial({ workOrderId: wo._id, actorId });
      await recordDecision({
        runId, workOrderId: wo._id, traceId: transfer._id, agentRole: "WMS",
        policyVersion: M20_AGENT_POLICY_VERSION,
        inputSnapshot: { materialId: transfer.materialId, quantity: transfer.quantity, lotId: reservation.lotId, handlingUnitId: reservation.handlingUnitId },
        reasonCodes: ["FEFO_LOT_SELECTED", "EXACT_HU_RESERVED", "PHYSICAL_PICK_CONFIRM_REQUIRED"],
        proposedAction: "ISSUE_PICK_TASK", result: "AUTO_EXECUTED", idempotencyKey: `${runId}:WMS:RESERVE`,
      });
    } catch (error) {
      await recordDecision({
        runId, workOrderId: wo._id, traceId: transfer._id, agentRole: "WMS",
        policyVersion: M20_AGENT_POLICY_VERSION,
        inputSnapshot: { materialId: transfer.materialId, quantity: transfer.quantity },
        reasonCodes: ["FEFO_EXACT_HU_UNAVAILABLE"], proposedAction: "BLOCK_PICK_TASK",
        result: "BLOCKED", idempotencyKey: `${runId}:WMS:RESERVE`,
      });
      await agentRuns.updateOne({ _id: runId }, { $set: {
        status: purchaseOrder?.status === "PENDING_APPROVAL" ? "WAITING_APPROVAL" : "BLOCKED",
        stage: "CREATED", nextHumanAction: purchaseOrder?.status === "PENDING_APPROVAL" ? "PO_APPROVAL" : undefined,
        blockedReason: error instanceof Error ? error.message : "WMS 예약 실패",
        lastTrigger: trigger, updatedAt: new Date(),
      } });
      return getM20AgentSnapshot(workOrderId);
    }
  }

  transfer = await transferOrders.findOne({ _id: transfer._id });
  wo = await workOrders.findOne({ _id: wo._id });
  if (!transfer || !wo) throw new Error("에이전트 조율 중 원장이 사라졌습니다.");
  const events = await materialFlowEvents.find({ workOrderId: wo._id }).toArray();
  const picked = events.some((event) => event.type === "PICKED");
  const allocation = await materialAllocations.findOne({ _id: transfer.allocationId });

  if (transfer.status === "DELIVERED" && allocation?.status === "RELEASED" && wo.status === "MATERIAL_WAIT") {
    if (roleModes.MES === "HUMAN" && trigger === "AUTO") {
      await recordDecision({
        runId, workOrderId: wo._id, traceId: transfer._id, agentRole: "MES",
        policyVersion: M20_AGENT_POLICY_VERSION,
        inputSnapshot: { transferStatus: transfer.status, allocationStatus: allocation.status },
        reasonCodes: ["HUMAN_MODE_ACTIVE"], proposedAction: "MANUAL_RELEASE_REQUIRED",
        result: "HUMAN_MODE_HOLD", idempotencyKey: `${runId}:MES:HOLD`,
      });
      await agentRuns.updateOne({ _id: runId }, { $set: {
        status: "HUMAN_MODE_HOLD", stage: "RELEASED", nextHumanAction: "MES_MANUAL_RUN",
        blockedReason: "MES 담당이 HUMAN 모드입니다. 담당자가 직접 설비 배정을 실행해야 합니다.",
        lastTrigger: trigger, updatedAt: new Date(),
      } });
      return getM20AgentSnapshot(workOrderId);
    }
    await releaseMesAndAssignEquipment(wo, transfer._id);
    wo = await workOrders.findOne({ _id: wo._id }) ?? wo;
  } else if (wo.status === "MATERIAL_WAIT") {
    await recordDecision({
      runId, workOrderId: wo._id, traceId: transfer._id, agentRole: "MES",
      policyVersion: M20_AGENT_POLICY_VERSION,
      inputSnapshot: { transferStatus: transfer.status, allocationStatus: allocation?.status ?? "MISSING" },
      reasonCodes: ["LINE_SIDE_NOT_READY"], proposedAction: "WAIT_WO_RELEASE",
      result: "WAITING_PHYSICAL", idempotencyKey: `${runId}:MES:WAIT:${transfer.status}:${picked ? "PICKED" : "NOT_PICKED"}`,
    });
  }

  const next: Pick<AgentRunDoc, "status" | "stage" | "nextHumanAction" | "blockedReason"> =
    wo.status === "DONE"
      ? { status: "COMPLETED", stage: "CONSUMED", nextHumanAction: undefined, blockedReason: null }
      : transfer.status === "PICKING" && !picked
        ? { status: "WAITING_PHYSICAL", stage: "RESERVED", nextHumanAction: "PICK_CONFIRM", blockedReason: null }
        : transfer.status === "PICKING"
          ? { status: "WAITING_PHYSICAL", stage: "PICKED", nextHumanAction: "STAGE_CONFIRM", blockedReason: null }
          : transfer.status === "STAGED"
            ? { status: "WAITING_PHYSICAL", stage: "STAGED", nextHumanAction: "DEPART_CONFIRM", blockedReason: null }
            : transfer.status === "IN_TRANSIT"
              ? { status: "WAITING_PHYSICAL", stage: "IN_TRANSIT", nextHumanAction: "RECEIVE_CONFIRM", blockedReason: null }
              : transfer.status === "RECEIVED"
                ? { status: "WAITING_PHYSICAL", stage: "RECEIVED", nextHumanAction: "DELIVER_CONFIRM", blockedReason: null }
                : transfer.status === "DELIVERED" && wo.status === "QUEUED"
                  ? { status: "WAITING_PHYSICAL", stage: "RELEASED", nextHumanAction: "CONSUME_CONFIRM", blockedReason: null }
                  : { status: "OPEN", stage: "CREATED", nextHumanAction: undefined, blockedReason: null };
  await agentRuns.updateOne({ _id: runId }, { $set: { ...next, lastTrigger: trigger, updatedAt: new Date() } });
  if (wo.status === "DONE") {
    await equipmentAssignments.updateMany({ workOrderId: wo._id, status: { $in: ["RESERVED", "ACTIVE"] } }, { $set: { status: "COMPLETED", updatedAt: new Date() } });
  }
  return getM20AgentSnapshot(workOrderId);
}

export async function getM20AgentSnapshot(workOrderId: string) {
  const { agentRuns, agentDecisions, purchaseOrderDrafts, integrationOutbox, equipmentAssignments } = await collections();
  const runId = runIdFor(workOrderId);
  const [run, decisions, purchaseOrder, assignment, roleModes] = await Promise.all([
    agentRuns.findOne({ _id: runId }),
    agentDecisions.find({ runId }).sort({ createdAt: 1 }).toArray(),
    purchaseOrderDrafts.findOne({ sourceWorkOrderId: workOrderId }, { sort: { createdAt: -1 } }),
    equipmentAssignments.findOne({ workOrderId }, { sort: { createdAt: -1 } }),
    getRoleModes(),
  ]);
  const outbox = purchaseOrder ? await integrationOutbox.findOne({ aggregateId: purchaseOrder._id }) : null;
  return { run, decisions, purchaseOrder, outbox, assignment, roleModes };
}

export async function decidePurchaseOrder(input: {
  purchaseOrderId: string;
  action: "APPROVE" | "REJECT";
  actorId: string;
  reason?: string;
}) {
  const { purchaseOrderDrafts, integrationOutbox } = await collections();
  const po = await purchaseOrderDrafts.findOne({ _id: input.purchaseOrderId });
  if (!po) throw new Error("발주 초안이 없습니다.");
  if (po.status !== "PENDING_APPROVAL") {
    const outbox = await integrationOutbox.findOne({ aggregateId: po._id });
    return { purchaseOrder: po, outbox, idempotent: true };
  }
  const now = new Date();
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      if (input.action === "REJECT") {
        await purchaseOrderDrafts.updateOne(
          { _id: po._id, status: "PENDING_APPROVAL" },
          { $set: { status: "REJECTED", rejectedBy: input.actorId, rejectedAt: now, rejectionReason: input.reason ?? "승인자 반려", updatedAt: now } },
          { session },
        );
        return;
      }
      const approved = await purchaseOrderDrafts.updateOne(
        { _id: po._id, status: "PENDING_APPROVAL" },
        { $set: { status: "OUTBOXED", approvedBy: input.actorId, approvedAt: now, updatedAt: now } },
        { session },
      );
      if (!approved.modifiedCount) throw new Error("PO_APPROVAL_CHANGED");
      await integrationOutbox.insertOne({
        _id: `OUTBOX:${po._id}`,
        aggregateType: "PURCHASE_ORDER",
        aggregateId: po._id,
        eventType: "PURCHASE_ORDER_APPROVED",
        payload: {
          poNo: po.poNo, materialId: po.materialId, supplierId: po.supplierId,
          quantity: po.quantity, unit: po.unit, unitPrice: po.unitPrice,
          currency: po.currency, expectedDate: po.expectedDate.toISOString(),
          policyVersion: po.policyVersion,
        },
        status: "PENDING",
        createdAt: now,
      }, { session });
    });
  } finally {
    await session.endSession();
  }
  return {
    purchaseOrder: await purchaseOrderDrafts.findOne({ _id: po._id }),
    outbox: await integrationOutbox.findOne({ aggregateId: po._id }),
    idempotent: false,
  };
}

const M20_PILOT_MATERIAL_ID = "PKG-001";

// "+ M20 에이전트 흐름" 버튼(POST /api/mes/workorders, scope: M20_PILOT)과 완전히 같은 로직을
// 서버 함수로 뽑아둔 것 — 사람이 버튼을 눌러 시작하는 경우와, 웨이퍼 로트가 패키징 노드에
// 진입해 자동으로 새 소비 사이클이 필요해지는 경우 둘 다 이 함수를 통해 같은 방식으로 워크오더를 만든다.
export async function createM20PilotWorkOrder(actorId: string, requestId: string): Promise<WorkOrderDoc> {
  const fabId = "M20" as const;
  const product = "HBM" as const;
  const processCode = "P10";
  const plannedQty = 1;

  const { workOrders, bomTemplates, materials, inventory, materialAllocations, transferOrders, materialFlowEvents } = await collections();

  const existing = await workOrders.findOne({ requestId });
  if (existing) return existing;

  const templateId = `${processCode}-${product}`;
  const template = await bomTemplates.findOne({ _id: templateId });
  if (!template?.lines.length) throw new Error(`${templateId} BOM 템플릿이 비어 있습니다.`);
  const selectedLines = template.lines.filter((line) => line.materialId === M20_PILOT_MATERIAL_ID);
  if (!selectedLines.length) throw new Error(`${M20_PILOT_MATERIAL_ID}가 ${templateId} BOM에 없습니다.`);
  const bomLines: BomLine[] = selectedLines.map((line) => ({
    materialId: line.materialId,
    plannedQty: Math.round(line.qtyPerRun * plannedQty * 100) / 100,
    pickedQty: 0, consumedQty: 0, pickedLots: [],
  }));

  const now = new Date();
  const wo: WorkOrderDoc = {
    _id: `WO-${fabId}-${randomUUID()}`,
    fabId, processCode, product, plannedQty, plannedQtyUnit: "RUN",
    scope: "M20_PILOT", requestId, status: "MATERIAL_WAIT", bomLines,
    createdBy: actorId, createdAt: now, updatedAt: now,
    note: "M20 대표 수직 흐름 · 웨이퍼 로트 실행 원장에서 자동 생성",
  };

  const materialDocs = await materials.find({ _id: { $in: bomLines.map((line) => line.materialId) } }).toArray();
  const inventoryDocs = await inventory.find({
    materialId: { $in: bomLines.map((line) => line.materialId) },
    quantity: { $gt: 0 },
    status: { $nin: ["HOLD", "QUARANTINE", "CONSUMED"] },
  }).sort({ quantity: -1 }).toArray();
  const unitByMaterial = new Map(materialDocs.map((material) => [material._id, material.unit]));
  const sourceByMaterial = new Map<string, string>();
  for (const row of inventoryDocs) if (!sourceByMaterial.has(row.materialId)) sourceByMaterial.set(row.materialId, row.warehouseId);
  const allocations: MaterialAllocationDoc[] = bomLines.map((line) => ({
    _id: randomUUID(),
    materialId: line.materialId, fabId, quantity: line.plannedQty,
    unit: unitByMaterial.get(line.materialId) ?? "EA", status: "PLANNED",
    sourceFacilityId: sourceByMaterial.get(line.materialId) ?? "UNASSIGNED-WMS",
    destinationFacilityId: `FAB-${fabId}`, workOrderId: wo._id, source: "MES",
    createdAt: now, updatedAt: now,
  }));
  const transfers: TransferOrderDoc[] = allocations.map((allocation) => ({
    _id: randomUUID(),
    allocationId: allocation._id, workOrderId: wo._id, materialId: allocation.materialId,
    fabId: allocation.fabId, quantity: allocation.quantity, unit: allocation.unit,
    fromFacilityId: allocation.sourceFacilityId, toFacilityId: allocation.destinationFacilityId,
    processCode, status: "CREATED", requestedAt: now, version: 1, createdAt: now, updatedAt: now,
  }));
  const allocationEvents: MaterialFlowEventDoc[] = transfers.map((transfer) => ({
    _id: randomUUID(),
    materialId: transfer.materialId, fabId: transfer.fabId, type: "ALLOCATED",
    quantity: transfer.quantity, unit: transfer.unit, facilityId: transfer.fromFacilityId,
    allocationId: transfer.allocationId, transferOrderId: transfer._id, workOrderId: wo._id, processCode,
    requestId: `${requestId}:ALLOCATED:${transfer.materialId}`, sequence: 1, occurredAt: now, recordedBy: actorId,
  }));

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await workOrders.insertOne(wo, { session });
      if (allocations.length) await materialAllocations.insertMany(allocations, { session });
      if (transfers.length) await transferOrders.insertMany(transfers, { session });
      if (allocationEvents.length) await materialFlowEvents.insertMany(allocationEvents, { session });
    });
  } finally {
    await session.endSession();
  }
  await orchestrateM20Agents(wo._id, actorId);
  return wo;
}
