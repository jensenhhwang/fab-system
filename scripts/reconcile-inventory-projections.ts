import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import {
  collections,
  getMongoClient,
  type HandlingUnitDoc,
  type InventoryLotDoc,
  type InventoryReconciliationBatchDoc,
  type InventoryReconciliationEntryDoc,
  type InventoryReconciliationMetadata,
  type StorageLocationDoc,
  type WarehouseZoneDoc,
} from "../src/lib/db";
import {
  OPENING_RECONCILIATION_VERSION,
  buildOpeningReconciliationPlan,
  reconciliationHoldLocationId,
  reconciliationHoldZoneId,
  type OpeningReconciliationInput,
  type OpeningReconciliationPlan,
} from "../src/lib/inventory-physical-reconciliation";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rollbackIndex = args.indexOf("--rollback");
const rollbackBatchId = rollbackIndex >= 0 ? args[rollbackIndex + 1] : undefined;

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sortableDoc(doc: { _id: string }): string {
  return doc._id;
}

async function loadState(session?: ClientSession): Promise<OpeningReconciliationInput> {
  const c = await collections();
  const options = session ? { session } : {};
  const reads = [
    () => c.materials.find({}, options).sort({ _id: 1 }).toArray(),
    () => c.inventory.find({}, options).sort({ _id: 1 }).toArray(),
    () => c.inventoryLots.find({}, options).sort({ _id: 1 }).toArray(),
    () => c.handlingUnits.find({}, options).sort({ _id: 1 }).toArray(),
    () => c.storageLocations.find({}, options).sort({ _id: 1 }).toArray(),
    () => c.transferOrders.find({}, options).sort({ _id: 1 }).toArray(),
    () => c.workOrders.find({}, options).sort({ _id: 1 }).toArray(),
  ] as const;
  const result = session
    ? [
        await reads[0](),
        await reads[1](),
        await reads[2](),
        await reads[3](),
        await reads[4](),
        await reads[5](),
        await reads[6](),
      ]
    : await Promise.all(reads.map((read) => read()));
  const [materials, inventory, lots, handlingUnits, locations, transfers, workOrders] = result as [
    Awaited<ReturnType<(typeof reads)[0]>>,
    Awaited<ReturnType<(typeof reads)[1]>>,
    Awaited<ReturnType<(typeof reads)[2]>>,
    Awaited<ReturnType<(typeof reads)[3]>>,
    Awaited<ReturnType<(typeof reads)[4]>>,
    Awaited<ReturnType<(typeof reads)[5]>>,
    Awaited<ReturnType<(typeof reads)[6]>>,
  ];
  return { materials, inventory, lots, handlingUnits, locations, transfers, workOrders };
}

function stateFingerprint(state: OpeningReconciliationInput): string {
  return stableHash({
    version: OPENING_RECONCILIATION_VERSION,
    materials: state.materials.map((doc) => ({
      _id: doc._id,
      safetyStock: doc.safetyStock,
      assumptionConfidence: doc.assumptionConfidence,
      inventoryBaselineVersion: doc.inventoryBaselineVersion,
    })),
    inventory: [...state.inventory].sort((a, b) => sortableDoc(a).localeCompare(sortableDoc(b))),
    lots: [...state.lots].sort((a, b) => sortableDoc(a).localeCompare(sortableDoc(b))),
    handlingUnits: [...state.handlingUnits].sort((a, b) => sortableDoc(a).localeCompare(sortableDoc(b))),
    locations: [...state.locations].sort((a, b) => sortableDoc(a).localeCompare(sortableDoc(b))),
    transfers: state.transfers
      .filter((doc) => ["PICKING", "STAGED", "IN_TRANSIT", "RECEIVED"].includes(doc.status))
      .sort((a, b) => sortableDoc(a).localeCompare(sortableDoc(b))),
    workOrders: state.workOrders
      .filter((doc) => doc.status !== "DONE")
      .sort((a, b) => sortableDoc(a).localeCompare(sortableDoc(b))),
  });
}

function aggregateHash(state: OpeningReconciliationInput): string {
  return stableHash(
    state.inventory
      .map((row) => ({
        _id: row._id,
        materialId: row.materialId,
        warehouseId: row.warehouseId,
        quantity: row.quantity,
        status: row.status,
        updatedAt: row.updatedAt,
      }))
      .sort((a, b) => a._id.localeCompare(b._id)),
  );
}

function reconciliationMetadata(input: {
  batchId: string;
  fingerprint: string;
  projectionKind: InventoryReconciliationMetadata["projectionKind"];
  now: Date;
  sourceInventoryIds?: string[];
  sourceHandlingUnitIds?: string[];
}): InventoryReconciliationMetadata {
  return {
    version: OPENING_RECONCILIATION_VERSION,
    batchId: input.batchId,
    fingerprint: input.fingerprint,
    origin: "MODELED_OPENING_PROJECTION",
    verificationStatus: "PENDING_PHYSICAL_VERIFICATION",
    projectionKind: input.projectionKind,
    ...(input.sourceInventoryIds ? { sourceInventoryIds: input.sourceInventoryIds } : {}),
    ...(input.sourceHandlingUnitIds ? { sourceHandlingUnitIds: input.sourceHandlingUnitIds } : {}),
    createdAt: input.now,
  };
}

function buildDocuments(input: {
  plan: OpeningReconciliationPlan;
  state: OpeningReconciliationInput;
  batchId: string;
  fingerprint: string;
  now: Date;
}) {
  const metadataBase = {
    batchId: input.batchId,
    fingerprint: input.fingerprint,
    now: input.now,
  };
  const recoveryLots: InventoryLotDoc[] = input.plan.recoveryLots.map((item) => ({
    _id: item.lotId,
    materialId: item.materialId,
    lotNo: `RECON-RECOVERED-${item.lotId}`,
    quantity: item.quantity,
    availableQuantity: item.availableQuantity,
    qualityStatus: "HOLD",
    holdReason: "OPENING_RECONCILIATION · 원본 Lot 참조 복구 · 현장 검증 필요",
    updatedAt: input.now,
    warehouseId: item.warehouseId,
    ...(item.locationId ? { slotId: item.locationId } : {}),
    reconciliation: reconciliationMetadata({
      ...metadataBase,
      projectionKind: "RECOVERED_LOT_REFERENCE",
      sourceHandlingUnitIds: item.sourceHandlingUnitIds,
    }),
  }));
  const fillHandlingUnits: HandlingUnitDoc[] = input.plan.fillHandlingUnits.map((item) => {
    const locationId = reconciliationHoldLocationId(item.warehouseId);
    return {
      _id: item.handlingUnitId,
      inventoryLotId: item.lotId,
      materialId: item.materialId,
      warehouseId: item.warehouseId,
      locationId,
      containerType: "MODELED_CONTAINER_GROUP",
      quantity: item.quantity,
      status: "HOLD",
      logisticsStatus: "STORED",
      currentFacilityId: item.warehouseId,
      currentLocationId: locationId,
      version: 0,
      updatedAt: input.now,
      reconciliation: reconciliationMetadata({
        ...metadataBase,
        projectionKind: "MODELED_CONTAINER_GROUP",
      }),
    };
  });
  const openingLots: InventoryLotDoc[] = input.plan.openingPositions.map((item) => {
    const locationId = reconciliationHoldLocationId(item.warehouseId);
    return {
      _id: item.lotId,
      materialId: item.materialId,
      lotNo: `RECON-OPENING-${item.materialId}`,
      quantity: item.quantity,
      availableQuantity: item.quantity,
      qualityStatus: "HOLD",
      holdReason: "OPENING_RECONCILIATION · 모델 기준재고 · 현장 검증 필요",
      updatedAt: input.now,
      warehouseId: item.warehouseId,
      slotId: locationId,
      reconciliation: reconciliationMetadata({
        ...metadataBase,
        projectionKind: "MODELED_CONTAINER_GROUP",
        sourceInventoryIds: item.sourceInventoryIds,
      }),
    };
  });
  const openingHandlingUnits: HandlingUnitDoc[] = input.plan.openingPositions.map((item) => {
    const locationId = reconciliationHoldLocationId(item.warehouseId);
    return {
      _id: item.handlingUnitId,
      inventoryLotId: item.lotId,
      materialId: item.materialId,
      warehouseId: item.warehouseId,
      locationId,
      containerType: "MODELED_CONTAINER_GROUP",
      quantity: item.quantity,
      status: "HOLD",
      logisticsStatus: "STORED",
      currentFacilityId: item.warehouseId,
      currentLocationId: locationId,
      version: 0,
      updatedAt: input.now,
      reconciliation: reconciliationMetadata({
        ...metadataBase,
        projectionKind: "MODELED_CONTAINER_GROUP",
        sourceInventoryIds: item.sourceInventoryIds,
      }),
    };
  });
  const lots = [...recoveryLots, ...openingLots];
  const handlingUnits = [...fillHandlingUnits, ...openingHandlingUnits];
  const existingLocationIds = new Set(input.state.locations.map((location) => location._id));
  const zones: WarehouseZoneDoc[] = input.plan.requiredHoldWarehouses
    .filter((warehouseId) => !existingLocationIds.has(reconciliationHoldLocationId(warehouseId)))
    .map((warehouseId) => ({
      _id: reconciliationHoldZoneId(warehouseId),
      warehouseId,
      code: "RECON-HOLD",
      name: "실물검증 대기 모델재고",
      zoneType: "RECONCILIATION_HOLD",
      accessLevel: "RESTRICTED",
    }));
  const locations: StorageLocationDoc[] = zones.map((zone) => ({
    _id: reconciliationHoldLocationId(zone.warehouseId),
    warehouseId: zone.warehouseId,
    zoneId: zone._id,
    code: "RECON-HOLD",
    locationType: "PROCESS",
    capacity: Math.max(
      1,
      handlingUnits.filter((unit) => unit.warehouseId === zone.warehouseId).length,
    ),
    status: "BLOCKED",
    operationalPurpose: "RECONCILIATION_HOLD",
    position: { x: 0, y: 0, z: 0 },
  }));
  return { lots, handlingUnits, zones, locations };
}

function buildEntries(input: {
  plan: OpeningReconciliationPlan;
  batchId: string;
  now: Date;
}): InventoryReconciliationEntryDoc[] {
  const entries: Omit<InventoryReconciliationEntryDoc, "_id">[] = [
    ...input.plan.recoveryLots.map((item) => ({
      batchId: input.batchId,
      materialId: item.materialId,
      warehouseId: item.warehouseId,
      kind: "RECOVER_ORPHAN_HU_LOT" as const,
      status: "APPLIED" as const,
      quantity: item.quantity,
      referenceIds: [item.lotId, ...item.sourceHandlingUnitIds],
      createdAt: input.now,
    })),
    ...input.plan.fillHandlingUnits.map((item) => ({
      batchId: input.batchId,
      materialId: item.materialId,
      warehouseId: item.warehouseId,
      kind: "FILL_EXISTING_LOT_HU" as const,
      status: "APPLIED" as const,
      quantity: item.quantity,
      referenceIds: [item.lotId, item.handlingUnitId],
      createdAt: input.now,
    })),
    ...input.plan.openingPositions.map((item) => ({
      batchId: input.batchId,
      materialId: item.materialId,
      warehouseId: item.warehouseId,
      kind: "OPENING_POSITION" as const,
      status: "APPLIED" as const,
      quantity: item.quantity,
      referenceIds: [item.lotId, item.handlingUnitId, ...item.sourceInventoryIds],
      createdAt: input.now,
    })),
    ...input.plan.summaries
      .filter((summary) => summary.status === "SKIPPED_UNCALIBRATED_ZERO_BASELINE")
      .map((summary) => ({
        batchId: input.batchId,
        materialId: summary.materialId,
        kind: "SKIP" as const,
        status: "SKIPPED_UNCALIBRATED_ZERO_BASELINE" as const,
        quantity: 0,
        referenceIds: [],
        createdAt: input.now,
      })),
  ];
  return entries.map((entry, index) => ({
    _id: `${input.batchId}:${String(index + 1).padStart(3, "0")}`,
    ...entry,
  }));
}

function printPlan(plan: OpeningReconciliationPlan, fingerprint: string): void {
  const planned = plan.summaries.filter((summary) => summary.status === "PLANNED").length;
  const matched = plan.summaries.filter((summary) => summary.status === "MATCHED").length;
  const skipped = plan.summaries.filter((summary) => summary.status.startsWith("SKIPPED")).length;
  console.log(
    `[inventory-reconciliation] version=${plan.version} fingerprint=${fingerprint.slice(0, 12)}`
    + ` recoveryLots=${plan.recoveryLots.length} fillHU=${plan.fillHandlingUnits.length}`
    + ` openingPositions=${plan.openingPositions.length} planned=${planned} matched=${matched}`
    + ` skipped=${skipped} blocked=${plan.blocks.length}`,
  );
  for (const summary of plan.summaries) {
    if (summary.status === "MATCHED" || summary.status.startsWith("SKIPPED")) continue;
    console.log(
      `${summary.materialId}\t${summary.status}\tagg=${summary.aggregateOnHand}`
      + `\tlot=${summary.lotPhysicalBefore}->${summary.lotPhysicalAfter}`
      + `\thu=${summary.huPhysicalBefore}->${summary.huPhysicalAfter}`,
    );
  }
  for (const block of plan.blocks) {
    console.error(`[BLOCKED] ${block.materialId}\t${block.code}\t${block.referenceId ?? "-"}\t${block.detail}`);
  }
}

async function applyPlan(): Promise<void> {
  const initialState = await loadState();
  const initialFingerprint = stateFingerprint(initialState);
  const initialPlan = buildOpeningReconciliationPlan(initialState);
  printPlan(initialPlan, initialFingerprint);
  if (initialPlan.blocks.length > 0) {
    throw new Error(`RECONCILIATION_BLOCKED:${initialPlan.blocks.length}`);
  }
  if (!apply) {
    console.log("변경 없음. 실제 적용: npm run db:reconcile-inventory-projections -- --apply");
    return;
  }

  const c = await collections();
  await Promise.all([
    c.inventoryReconciliationBatches.createIndex({ fingerprint: 1 }, { unique: true, name: "uniq_reconciliation_fingerprint" }),
    c.inventoryReconciliationEntries.createIndex({ batchId: 1, materialId: 1 }, { name: "reconciliation_batch_material" }),
  ]);
  const batchId = `RECON-${new Date().toISOString()}-${randomUUID().slice(0, 6)}`;
  const now = new Date();
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const state = await loadState(session);
      const fingerprint = stateFingerprint(state);
      if (fingerprint !== initialFingerprint) throw new Error("STALE_RECONCILIATION_PLAN");
      const plan = buildOpeningReconciliationPlan(state);
      if (plan.blocks.length > 0) throw new Error(`RECONCILIATION_BLOCKED:${plan.blocks.length}`);
      const aggregateHashBefore = aggregateHash(state);
      const docs = buildDocuments({ plan, state, batchId, fingerprint, now });
      const entries = buildEntries({ plan, batchId, now });
      if (docs.zones.length > 0) await c.warehouseZones.insertMany(docs.zones, { session });
      if (docs.locations.length > 0) await c.storageLocations.insertMany(docs.locations, { session });
      if (docs.lots.length > 0) await c.inventoryLots.insertMany(docs.lots, { session });
      if (docs.handlingUnits.length > 0) await c.handlingUnits.insertMany(docs.handlingUnits, { session });
      if (entries.length > 0) await c.inventoryReconciliationEntries.insertMany(entries, { session });
      const afterState = await loadState(session);
      const aggregateHashAfter = aggregateHash(afterState);
      if (aggregateHashAfter !== aggregateHashBefore) throw new Error("AGGREGATE_INVENTORY_CHANGED");
      const afterPlan = buildOpeningReconciliationPlan(afterState);
      if (afterPlan.blocks.length > 0) throw new Error(`POST_RECONCILIATION_BLOCKED:${afterPlan.blocks.length}`);
      const unmatched = afterPlan.summaries.filter(
        (summary) => summary.status !== "MATCHED"
          && summary.status !== "SKIPPED_ZERO_BASELINE"
          && summary.status !== "SKIPPED_UNCALIBRATED_ZERO_BASELINE",
      );
      if (unmatched.length > 0 || afterPlan.recoveryLots.length > 0 || afterPlan.fillHandlingUnits.length > 0 || afterPlan.openingPositions.length > 0) {
        throw new Error("POST_RECONCILIATION_NOT_IDEMPOTENT");
      }
      const preExistingHandlingUnitIdsByCreatedLot = Object.fromEntries([
        ...plan.recoveryLots.map((item) => [item.lotId, item.sourceHandlingUnitIds]),
        ...plan.openingPositions.map((item) => [item.lotId, []]),
      ]);
      const batch: InventoryReconciliationBatchDoc = {
        _id: batchId,
        version: OPENING_RECONCILIATION_VERSION,
        fingerprint,
        status: "APPLIED",
        createdAt: now,
        aggregateHashBefore,
        aggregateHashAfter,
        createdLotIds: docs.lots.map((doc) => doc._id),
        createdHandlingUnitIds: docs.handlingUnits.map((doc) => doc._id),
        createdLocationIds: docs.locations.map((doc) => doc._id),
        createdZoneIds: docs.zones.map((doc) => doc._id),
        preExistingHandlingUnitIdsByCreatedLot,
        createdLots: docs.lots,
        createdHandlingUnits: docs.handlingUnits,
      };
      await c.inventoryReconciliationBatches.insertOne(batch, { session });
    });
  } finally {
    await session.endSession();
  }
  console.log(`[inventory-reconciliation] applied batch=${batchId}`);
  console.log(`rollback: npm run db:reconcile-inventory-projections -- --rollback ${batchId}`);
}

function sameDocument(left: unknown, right: unknown): boolean {
  return stableHash(left) === stableHash(right);
}

async function rollback(batchId: string): Promise<void> {
  const c = await collections();
  const batch = await c.inventoryReconciliationBatches.findOne({ _id: batchId });
  if (!batch) throw new Error(`RECONCILIATION_BATCH_NOT_FOUND:${batchId}`);
  if (batch.status !== "APPLIED") throw new Error(`RECONCILIATION_BATCH_NOT_APPLIED:${batch.status}`);
  const [currentLots, currentUnits] = await Promise.all([
    c.inventoryLots.find({ _id: { $in: batch.createdLotIds } }).toArray(),
    c.handlingUnits.find({ _id: { $in: batch.createdHandlingUnitIds } }).toArray(),
  ]);
  for (const expected of batch.createdLots) {
    const current = currentLots.find((doc) => doc._id === expected._id);
    if (!current || !sameDocument(current, expected)) throw new Error(`ROLLBACK_LOT_CHANGED:${expected._id}`);
  }
  for (const expected of batch.createdHandlingUnits) {
    const current = currentUnits.find((doc) => doc._id === expected._id);
    if (!current || !sameDocument(current, expected)) throw new Error(`ROLLBACK_HU_CHANGED:${expected._id}`);
  }
  const [movementRef, transferRef, allocationRef, workOrderRef] = await Promise.all([
    c.inventoryMovements.findOne({
      $or: [
        { lotId: { $in: batch.createdLotIds } },
        { handlingUnitId: { $in: batch.createdHandlingUnitIds } },
      ],
    }),
    c.transferOrders.findOne({
      $or: [
        { lotId: { $in: batch.createdLotIds } },
        { handlingUnitId: { $in: batch.createdHandlingUnitIds } },
      ],
    }),
    c.materialAllocations.findOne({ inventoryLotIds: { $in: batch.createdLotIds } }),
    c.workOrders.findOne({ "bomLines.pickedLots.lotId": { $in: batch.createdLotIds } }),
  ]);
  if (movementRef || transferRef || allocationRef || workOrderRef) throw new Error("ROLLBACK_CREATED_DOCUMENT_REFERENCED");
  for (const lotId of batch.createdLotIds) {
    const allowed = new Set([
      ...(batch.preExistingHandlingUnitIdsByCreatedLot[lotId] ?? []),
      ...batch.createdHandlingUnitIds,
    ]);
    const unexpected = await c.handlingUnits.findOne({ inventoryLotId: lotId, _id: { $nin: [...allowed] } });
    if (unexpected) throw new Error(`ROLLBACK_LOT_HAS_NEW_HU:${lotId}:${unexpected._id}`);
  }

  const now = new Date();
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      if (batch.createdHandlingUnitIds.length > 0) {
        await c.handlingUnits.deleteMany({ _id: { $in: batch.createdHandlingUnitIds } }, { session });
      }
      if (batch.createdLotIds.length > 0) {
        await c.inventoryLots.deleteMany({ _id: { $in: batch.createdLotIds } }, { session });
      }
      for (const locationId of batch.createdLocationIds) {
        const used = await c.handlingUnits.findOne({
          $or: [{ locationId }, { currentLocationId: locationId }],
        }, { session });
        if (used) throw new Error(`ROLLBACK_LOCATION_IN_USE:${locationId}`);
      }
      if (batch.createdLocationIds.length > 0) {
        await c.storageLocations.deleteMany({ _id: { $in: batch.createdLocationIds } }, { session });
      }
      if (batch.createdZoneIds.length > 0) {
        await c.warehouseZones.deleteMany({ _id: { $in: batch.createdZoneIds } }, { session });
      }
      await c.inventoryReconciliationEntries.insertOne({
        _id: `${batchId}:ROLLBACK`,
        batchId,
        materialId: "*",
        kind: "ROLLBACK",
        status: "ROLLED_BACK",
        quantity: 0,
        referenceIds: [...batch.createdLotIds, ...batch.createdHandlingUnitIds],
        createdAt: now,
      }, { session });
      const result = await c.inventoryReconciliationBatches.updateOne(
        { _id: batchId, status: "APPLIED" },
        { $set: { status: "ROLLED_BACK", rolledBackAt: now } },
        { session },
      );
      if (!result.modifiedCount) throw new Error("ROLLBACK_BATCH_CHANGED");
    });
  } finally {
    await session.endSession();
  }
  console.log(`[inventory-reconciliation] rolledBack batch=${batchId}`);
}

async function main(): Promise<void> {
  if (rollbackIndex >= 0) {
    if (!rollbackBatchId) throw new Error("--rollback 뒤에 batch ID가 필요합니다.");
    await rollback(rollbackBatchId);
    return;
  }
  await applyPlan();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await (await getMongoClient()).close();
    } catch {
      // 연결 전 실패
    }
  });
