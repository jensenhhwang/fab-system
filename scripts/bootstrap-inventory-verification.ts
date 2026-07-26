import "dotenv/config";
import type { ClientSession } from "mongodb";
import {
  collections,
  getMongoClient,
  type HandlingUnitDoc,
  type InventoryLotDoc,
  type InventoryReconciliationBatchDoc,
  type InventoryVerificationCaseDoc,
  type InventoryVerificationEventDoc,
  type MaterialDoc,
  type StorageLocationDoc,
} from "../src/lib/db";
import {
  INVENTORY_VERIFICATION_VERSION,
  inventoryVerificationCaseId,
  isUncalibratedVerificationMaterial,
  verificationSourceSnapshotHash,
} from "../src/lib/inventory-verification";

const apply = process.argv.includes("--apply");

type BootstrapState = {
  materials: MaterialDoc[];
  lots: InventoryLotDoc[];
  handlingUnits: HandlingUnitDoc[];
  locations: StorageLocationDoc[];
  batches: InventoryReconciliationBatchDoc[];
  cases: InventoryVerificationCaseDoc[];
};

type CasePlan = {
  caseDoc: InventoryVerificationCaseDoc;
  eventDoc: InventoryVerificationEventDoc;
};

async function loadState(session?: ClientSession): Promise<BootstrapState> {
  const c = await collections();
  const options = session ? { session } : {};
  if (session) {
    const materials = await c.materials.find({}, options).toArray();
    const lots = await c.inventoryLots.find({}, options).toArray();
    const handlingUnits = await c.handlingUnits.find({}, options).toArray();
    const locations = await c.storageLocations.find({}, options).toArray();
    const batches = await c.inventoryReconciliationBatches.find({}, options).toArray();
    const cases = await c.inventoryVerificationCases.find({}, options).toArray();
    return { materials, lots, handlingUnits, locations, batches, cases };
  }
  const [materials, lots, handlingUnits, locations, batches, cases] = await Promise.all([
    c.materials.find({}).toArray(),
    c.inventoryLots.find({}).toArray(),
    c.handlingUnits.find({}).toArray(),
    c.storageLocations.find({}).toArray(),
    c.inventoryReconciliationBatches.find({}).toArray(),
    c.inventoryVerificationCases.find({}).toArray(),
  ]);
  return { materials, lots, handlingUnits, locations, batches, cases };
}

function buildPlans(state: BootstrapState, now: Date): { plans: CasePlan[]; blocks: string[]; existing: number } {
  const materialById = new Map(state.materials.map((doc) => [doc._id, doc]));
  const lotById = new Map(state.lots.map((doc) => [doc._id, doc]));
  const locationById = new Map(state.locations.map((doc) => [doc._id, doc]));
  const batchById = new Map(state.batches.map((doc) => [doc._id, doc]));
  const existingByKey = new Map(state.cases.map((doc) => [
    `${doc.reconciliationBatchId}::${doc.sourceHandlingUnitId}`,
    doc,
  ]));
  const candidates = state.handlingUnits.filter((unit) => (
    unit.reconciliation?.version === "OPENING_RECONCILIATION_V1"
    && unit.reconciliation.projectionKind === "MODELED_CONTAINER_GROUP"
    && (unit.reconciliation.sourceInventoryIds?.length ?? 0) > 0
  ));
  const plans: CasePlan[] = [];
  const blocks: string[] = [];
  let existing = 0;

  for (const unit of candidates) {
    if (isUncalibratedVerificationMaterial(unit.materialId)) {
      blocks.push(`${unit._id}: 미보정 자재에는 Verification Case를 만들 수 없음`);
      continue;
    }
    const material = materialById.get(unit.materialId);
    const lot = lotById.get(unit.inventoryLotId);
    const locationId = unit.currentLocationId ?? unit.locationId;
    const location = locationById.get(locationId);
    const batchId = unit.reconciliation!.batchId;
    const batch = batchById.get(batchId);
    if (!material || !lot || !location || !batch) {
      blocks.push(`${unit._id}: material/Lot/location/batch 참조 누락`);
      continue;
    }
    const valid = batch.status === "APPLIED"
      && lot.qualityStatus === "HOLD"
      && unit.status === "HOLD"
      && unit.logisticsStatus === "STORED"
      && unit.containerType === "MODELED_CONTAINER_GROUP"
      && lot.materialId === unit.materialId
      && lot.warehouseId === unit.warehouseId
      && lot.quantity === unit.quantity
      && lot.reconciliation?.batchId === batchId
      && lot.reconciliation.verificationStatus === "PENDING_PHYSICAL_VERIFICATION"
      && unit.reconciliation!.verificationStatus === "PENDING_PHYSICAL_VERIFICATION"
      && lot.reconciliation.fingerprint === unit.reconciliation!.fingerprint
      && batch.fingerprint === unit.reconciliation!.fingerprint
      && location.warehouseId === unit.warehouseId
      && location.operationalPurpose === "RECONCILIATION_HOLD";
    if (!valid) {
      blocks.push(`${unit._id}: APPLIED/HOLD/PENDING/MODELED source 계약 불일치`);
      continue;
    }
    const sourceSnapshotHash = verificationSourceSnapshotHash({
      batch,
      material,
      lot,
      handlingUnit: unit,
      holdLocation: location,
    });
    const key = `${batchId}::${unit._id}`;
    const already = existingByKey.get(key);
    if (already) {
      if (already.sourceSnapshotHash !== sourceSnapshotHash) {
        blocks.push(`${unit._id}: 기존 Case source snapshot과 현재 원장이 다름`);
      } else {
        existing += 1;
      }
      continue;
    }
    const caseId = inventoryVerificationCaseId(batchId, unit._id);
    const caseDoc: InventoryVerificationCaseDoc = {
      _id: caseId,
      reconciliationBatchId: batchId,
      reconciliationFingerprint: batch.fingerprint,
      materialId: material._id,
      materialCode: material.code,
      materialName: material.name,
      warehouseId: unit.warehouseId,
      sourceLotId: lot._id,
      sourceHandlingUnitId: unit._id,
      expectedQuantity: unit.quantity,
      uom: material.unit,
      reconciliationHoldLocationId: location._id,
      sourceSnapshotHash,
      status: "AWAITING_OBSERVATION",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    plans.push({
      caseDoc,
      eventDoc: {
        _id: `${caseId}:1`,
        caseId,
        sequence: 1,
        type: "CASE_CREATED",
        actorId: "SYSTEM_VERIFICATION_BOOTSTRAP",
        at: now,
      },
    });
  }
  return { plans, blocks, existing };
}

async function main(): Promise<void> {
  const now = new Date();
  const initial = buildPlans(await loadState(), now);
  console.log(
    `[inventory-verification-bootstrap] version=${INVENTORY_VERIFICATION_VERSION}`
    + ` planned=${initial.plans.length} existing=${initial.existing} blocked=${initial.blocks.length}`
    + ` mode=${apply ? "APPLY" : "DRY_RUN"}`,
  );
  for (const block of initial.blocks) console.error(`[BLOCKED] ${block}`);
  if (initial.blocks.length > 0) throw new Error(`VERIFICATION_BOOTSTRAP_BLOCKED:${initial.blocks.length}`);
  if (!apply) {
    console.log("변경 없음. 실제 적용: npm run db:bootstrap-inventory-verification -- --apply");
    return;
  }
  if (initial.plans.length === 0) {
    console.log("변경 없음.");
    return;
  }

  const c = await collections();
  await Promise.all([
    c.inventoryVerificationCases.createIndex(
      { reconciliationBatchId: 1, sourceHandlingUnitId: 1 },
      { unique: true, name: "uniq_verification_case_source" },
    ),
    c.inventoryVerificationCases.createIndex(
      { status: 1, warehouseId: 1, createdAt: 1 },
      { name: "verification_queue" },
    ),
    c.inventoryVerificationObservations.createIndex(
      { requestId: 1 },
      { unique: true, name: "uniq_verification_observation_request" },
    ),
    c.inventoryVerificationObservations.createIndex(
      { caseId: 1, recordedAt: -1 },
      { name: "verification_observation_history" },
    ),
    c.inventoryVerificationEvents.createIndex(
      { caseId: 1, sequence: 1 },
      { unique: true, name: "uniq_verification_event_sequence" },
    ),
  ]);

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const current = buildPlans(await loadState(session), now);
      if (current.blocks.length > 0) throw new Error(`VERIFICATION_BOOTSTRAP_BLOCKED:${current.blocks.length}`);
      if (current.plans.length !== initial.plans.length) throw new Error("STALE_VERIFICATION_BOOTSTRAP_PLAN");
      const currentIds = current.plans.map((item) => item.caseDoc._id).sort().join(",");
      const initialIds = initial.plans.map((item) => item.caseDoc._id).sort().join(",");
      if (currentIds !== initialIds) throw new Error("STALE_VERIFICATION_BOOTSTRAP_PLAN");
      await c.inventoryVerificationCases.insertMany(current.plans.map((item) => item.caseDoc), { session });
      await c.inventoryVerificationEvents.insertMany(current.plans.map((item) => item.eventDoc), { session });
    });
  } finally {
    await session.endSession();
  }
  console.log(`[inventory-verification-bootstrap] applied=${initial.plans.length}`);
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
