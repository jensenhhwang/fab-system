import "server-only";

import { randomUUID } from "node:crypto";
import { collections, getMongoClient, type InventoryVerificationCaseStatus } from "@/lib/db";
import {
  InventoryVerificationError,
  inventoryObservationRequestHash,
  parseInventoryObservation,
  verificationSourceSnapshotHash,
} from "@/lib/inventory-verification";

export type InventoryVerificationListFilters = {
  status?: InventoryVerificationCaseStatus;
  warehouseId?: string;
  materialId?: string;
  cursor?: string;
  limit?: number;
};

function safeObservation(doc: {
  _id: string;
  observedQuantity: string;
  uom: string;
  actualLocationId: string;
  evidenceReference: string;
  observedBy: string;
  recordedAt: Date;
}) {
  return {
    id: doc._id,
    observedQuantity: doc.observedQuantity,
    uom: doc.uom,
    actualLocationId: doc.actualLocationId,
    evidenceReference: doc.evidenceReference,
    observedBy: doc.observedBy,
    recordedAt: doc.recordedAt.toISOString(),
  };
}

export async function listInventoryVerificationCases(filters: InventoryVerificationListFilters) {
  const c = await collections();
  const limit = Math.min(100, Math.max(1, filters.limit ?? 60));
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.warehouseId) query.warehouseId = filters.warehouseId;
  if (filters.materialId) query.materialId = filters.materialId;
  if (filters.cursor) query._id = { $gt: filters.cursor };
  const cases = await c.inventoryVerificationCases.find(query).sort({ _id: 1 }).limit(limit + 1).toArray();
  const page = cases.slice(0, limit);
  const caseIds = page.map((item) => item._id);
  const [observations, materials, lots, units, locations, batches, actualLocations] = await Promise.all([
    c.inventoryVerificationObservations.find({ caseId: { $in: caseIds } }).toArray(),
    c.materials.find({ _id: { $in: page.map((item) => item.materialId) } }).toArray(),
    c.inventoryLots.find({ _id: { $in: page.map((item) => item.sourceLotId) } }).toArray(),
    c.handlingUnits.find({ _id: { $in: page.map((item) => item.sourceHandlingUnitId) } }).toArray(),
    c.storageLocations.find({ _id: { $in: page.map((item) => item.reconciliationHoldLocationId) } }).toArray(),
    c.inventoryReconciliationBatches.find({ _id: { $in: page.map((item) => item.reconciliationBatchId) } }).toArray(),
    c.storageLocations.find({
      warehouseId: { $in: [...new Set(page.map((item) => item.warehouseId))] },
      operationalPurpose: { $ne: "RECONCILIATION_HOLD" },
      status: { $ne: "MAINTENANCE" },
    }).sort({ warehouseId: 1, code: 1 }).toArray(),
  ]);
  const observationByCase = new Map(observations.map((doc) => [doc.caseId, doc]));
  const materialById = new Map(materials.map((doc) => [doc._id, doc]));
  const lotById = new Map(lots.map((doc) => [doc._id, doc]));
  const unitById = new Map(units.map((doc) => [doc._id, doc]));
  const locationById = new Map(locations.map((doc) => [doc._id, doc]));
  const batchById = new Map(batches.map((doc) => [doc._id, doc]));

  const items = page.map((caseDoc) => {
    const batch = batchById.get(caseDoc.reconciliationBatchId);
    const material = materialById.get(caseDoc.materialId);
    const lot = lotById.get(caseDoc.sourceLotId);
    const handlingUnit = unitById.get(caseDoc.sourceHandlingUnitId);
    const holdLocation = locationById.get(caseDoc.reconciliationHoldLocationId);
    const currentHash = batch && material && lot && handlingUnit && holdLocation
      ? verificationSourceSnapshotHash({ batch, material, lot, handlingUnit, holdLocation })
      : null;
    const sourceDrift = currentHash !== caseDoc.sourceSnapshotHash;
    const observation = observationByCase.get(caseDoc._id);
    return {
      id: caseDoc._id,
      materialId: caseDoc.materialId,
      materialCode: caseDoc.materialCode,
      materialName: caseDoc.materialName,
      warehouseId: caseDoc.warehouseId,
      expectedQuantity: caseDoc.expectedQuantity,
      uom: caseDoc.uom,
      holdLocationId: caseDoc.reconciliationHoldLocationId,
      reconciliationBatchId: caseDoc.reconciliationBatchId,
      status: sourceDrift ? "SOURCE_DRIFT" as const : caseDoc.status,
      version: caseDoc.version,
      sourceDrift,
      createdAt: caseDoc.createdAt.toISOString(),
      observedAt: caseDoc.observedAt?.toISOString(),
      observation: observation ? safeObservation(observation) : null,
      actualLocations: actualLocations
        .filter((location) => location.warehouseId === caseDoc.warehouseId)
        .map((location) => ({
          id: location._id,
          code: location.code,
          type: location.locationType,
          status: location.status,
        })),
    };
  });
  return {
    items,
    nextCursor: cases.length > limit ? page.at(-1)?._id ?? null : null,
  };
}

export async function getInventoryVerificationSummary() {
  const c = await collections();
  const grouped = await c.inventoryVerificationCases.aggregate<{ _id: InventoryVerificationCaseStatus; count: number }>([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]).toArray();
  const counts = Object.fromEntries(grouped.map((row) => [row._id, row.count]));
  return {
    total: grouped.reduce((sum, row) => sum + row.count, 0),
    awaitingObservation: counts.AWAITING_OBSERVATION ?? 0,
    observed: counts.OBSERVED ?? 0,
    sourceDrift: counts.SOURCE_DRIFT ?? 0,
  };
}

export async function submitInventoryObservation(input: {
  caseId: string;
  actorId: string;
  body: unknown;
}) {
  const observation = parseInventoryObservation(input.body);
  const requestHash = inventoryObservationRequestHash({
    caseId: input.caseId,
    actorId: input.actorId,
    observation,
  });
  const c = await collections();
  const duplicate = await c.inventoryVerificationObservations.findOne({ requestId: observation.requestId });
  if (duplicate) {
    if (duplicate.requestHash !== requestHash) {
      throw new InventoryVerificationError("IDEMPOTENCY_CONFLICT", "같은 requestId에 다른 관측 내용이 제출됐습니다.", 409);
    }
    return { duplicate: true, observation: safeObservation(duplicate) };
  }

  const now = new Date();
  const observationId = `IVO-${randomUUID()}`;
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const caseDoc = await c.inventoryVerificationCases.findOne({ _id: input.caseId }, { session });
      if (!caseDoc) throw new InventoryVerificationError("CASE_NOT_FOUND", "검증 Case를 찾을 수 없습니다.", 404);
      if (caseDoc.status !== "AWAITING_OBSERVATION") {
        throw new InventoryVerificationError("CASE_NOT_AWAITING_OBSERVATION", "이미 관측됐거나 제출할 수 없는 Case입니다.", 409);
      }
      if (caseDoc.version !== observation.expectedVersion) {
        throw new InventoryVerificationError("CASE_VERSION_CONFLICT", "Case 버전이 변경됐습니다.", 409);
      }
      if (caseDoc.uom !== observation.uom) {
        throw new InventoryVerificationError("UOM_MISMATCH", `관측 단위는 ${caseDoc.uom}만 허용됩니다.`, 422);
      }
      const batch = await c.inventoryReconciliationBatches.findOne({ _id: caseDoc.reconciliationBatchId }, { session });
      const material = await c.materials.findOne({ _id: caseDoc.materialId }, { session });
      const lot = await c.inventoryLots.findOne({ _id: caseDoc.sourceLotId }, { session });
      const handlingUnit = await c.handlingUnits.findOne({ _id: caseDoc.sourceHandlingUnitId }, { session });
      const holdLocation = await c.storageLocations.findOne({ _id: caseDoc.reconciliationHoldLocationId }, { session });
      if (!batch || !material || !lot || !handlingUnit || !holdLocation) {
        throw new InventoryVerificationError("CASE_SOURCE_DRIFT", "검증 원본 참조가 사라졌습니다.", 409);
      }
      const currentHash = verificationSourceSnapshotHash({ batch, material, lot, handlingUnit, holdLocation });
      if (currentHash !== caseDoc.sourceSnapshotHash) {
        throw new InventoryVerificationError("CASE_SOURCE_DRIFT", "검증 시작 후 원본 LOT/HU가 변경됐습니다.", 409);
      }
      const actualLocation = await c.storageLocations.findOne({ _id: observation.actualLocationId }, { session });
      if (!actualLocation || actualLocation.warehouseId !== caseDoc.warehouseId || actualLocation.status === "MAINTENANCE") {
        throw new InventoryVerificationError("ACTUAL_LOCATION_INVALID", "동일 창고의 등록된 실제 위치만 선택할 수 있습니다.", 422);
      }
      if (actualLocation.operationalPurpose === "RECONCILIATION_HOLD") {
        throw new InventoryVerificationError(
          "RECONCILIATION_HOLD_LOCATION_FORBIDDEN",
          "모델 검증대기 위치는 실제 관측 위치로 사용할 수 없습니다.",
          422,
        );
      }
      await c.inventoryVerificationObservations.insertOne({
        _id: observationId,
        requestId: observation.requestId,
        requestHash,
        caseId: caseDoc._id,
        caseVersion: caseDoc.version,
        observedQuantity: observation.observedQuantity,
        uom: observation.uom,
        actualLocationId: observation.actualLocationId,
        evidenceReference: observation.evidenceReference,
        observedBy: input.actorId,
        recordedAt: now,
      }, { session });
      const update = await c.inventoryVerificationCases.updateOne({
        _id: caseDoc._id,
        status: "AWAITING_OBSERVATION",
        version: observation.expectedVersion,
      }, {
        $set: {
          status: "OBSERVED",
          observedAt: now,
          observedBy: input.actorId,
          observationId,
          updatedAt: now,
        },
        $inc: { version: 1 },
      }, { session });
      if (!update.modifiedCount) {
        throw new InventoryVerificationError("CASE_VERSION_CONFLICT", "다른 작업자가 먼저 제출했습니다.", 409);
      }
      await c.inventoryVerificationEvents.insertOne({
        _id: `${caseDoc._id}:2`,
        caseId: caseDoc._id,
        sequence: 2,
        type: "OBSERVATION_SUBMITTED",
        actorId: input.actorId,
        at: now,
        requestId: observation.requestId,
        observationId,
      }, { session });
    });
  } catch (error) {
    const concurrentDuplicate = await c.inventoryVerificationObservations.findOne({ requestId: observation.requestId });
    if (concurrentDuplicate) {
      if (concurrentDuplicate.requestHash !== requestHash) {
        throw new InventoryVerificationError("IDEMPOTENCY_CONFLICT", "같은 requestId에 다른 관측 내용이 제출됐습니다.", 409);
      }
      return { duplicate: true, observation: safeObservation(concurrentDuplicate) };
    }
    throw error;
  } finally {
    await session.endSession();
  }
  const saved = await c.inventoryVerificationObservations.findOne({ _id: observationId });
  if (!saved) throw new Error("OBSERVATION_NOT_FOUND_AFTER_COMMIT");
  return { duplicate: false, observation: safeObservation(saved) };
}
