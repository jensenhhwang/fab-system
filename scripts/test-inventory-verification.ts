import assert from "node:assert/strict";
import type {
  HandlingUnitDoc,
  InventoryLotDoc,
  InventoryReconciliationBatchDoc,
  MaterialDoc,
  StorageLocationDoc,
} from "../src/lib/db";
import {
  InventoryVerificationError,
  inventoryObservationRequestHash,
  inventoryVerificationCaseId,
  normalizeObservedQuantity,
  parseInventoryObservation,
  verificationSourceSnapshotHash,
} from "../src/lib/inventory-verification";

const now = new Date("2026-07-26T00:00:00.000Z");
const material: MaterialDoc = {
  _id: "MAT-1",
  code: "MAT-1",
  name: "검증자재",
  category: "CSM",
  unit: "kg",
  safetyStock: 10,
  ropDays: 7,
};
const reconciliation = {
  version: "OPENING_RECONCILIATION_V1" as const,
  batchId: "BATCH-1",
  fingerprint: "fingerprint",
  origin: "MODELED_OPENING_PROJECTION" as const,
  verificationStatus: "PENDING_PHYSICAL_VERIFICATION" as const,
  projectionKind: "MODELED_CONTAINER_GROUP" as const,
  sourceInventoryIds: ["INV-1"],
  createdAt: now,
};
const lot: InventoryLotDoc = {
  _id: "LOT-1",
  materialId: "MAT-1",
  lotNo: "RECON-OPENING-MAT-1",
  quantity: 100,
  availableQuantity: 100,
  qualityStatus: "HOLD",
  updatedAt: now,
  warehouseId: "MWH-01",
  slotId: "RECON-HOLD",
  reconciliation,
};
const handlingUnit: HandlingUnitDoc = {
  _id: "HU-1",
  inventoryLotId: "LOT-1",
  materialId: "MAT-1",
  warehouseId: "MWH-01",
  locationId: "RECON-HOLD",
  currentFacilityId: "MWH-01",
  currentLocationId: "RECON-HOLD",
  containerType: "MODELED_CONTAINER_GROUP",
  quantity: 100,
  status: "HOLD",
  logisticsStatus: "STORED",
  version: 0,
  updatedAt: now,
  reconciliation,
};
const location: StorageLocationDoc = {
  _id: "RECON-HOLD",
  warehouseId: "MWH-01",
  zoneId: "RECON-ZONE",
  code: "RECON-HOLD",
  locationType: "PROCESS",
  capacity: 10,
  status: "BLOCKED",
  operationalPurpose: "RECONCILIATION_HOLD",
  position: { x: 0, y: 0, z: 0 },
};
const batch: InventoryReconciliationBatchDoc = {
  _id: "BATCH-1",
  version: "OPENING_RECONCILIATION_V1",
  fingerprint: "fingerprint",
  status: "APPLIED",
  createdAt: now,
  aggregateHashBefore: "same",
  aggregateHashAfter: "same",
  createdLotIds: ["LOT-1"],
  createdHandlingUnitIds: ["HU-1"],
  createdLocationIds: ["RECON-HOLD"],
  createdZoneIds: ["RECON-ZONE"],
  preExistingHandlingUnitIdsByCreatedLot: { "LOT-1": [] },
  createdLots: [lot],
  createdHandlingUnits: [handlingUnit],
};

{
  let thrown: unknown;
  try {
    normalizeObservedQuantity("001");
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof InventoryVerificationError);
}

assert.equal(normalizeObservedQuantity("10.5000"), "10.5");
assert.equal(normalizeObservedQuantity("0.000"), "0");

for (const invalid of [10, "-1", "1e3", "", "  "]) {
  assert.throws(() => normalizeObservedQuantity(invalid), InventoryVerificationError);
}

const parsed = parseInventoryObservation({
  requestId: "REQ-1",
  expectedVersion: 1,
  observedQuantity: "100.00",
  uom: "kg",
  actualLocationId: "MWH-01-A-01",
  evidenceReference: "PHOTO-001",
});
assert.equal(parsed.observedQuantity, "100");

const caseId = inventoryVerificationCaseId("BATCH-1", "HU-1");
assert.equal(caseId, inventoryVerificationCaseId("BATCH-1", "HU-1"));
assert.notEqual(caseId, inventoryVerificationCaseId("BATCH-1", "HU-2"));

const sourceHash = verificationSourceSnapshotHash({
  batch,
  material,
  lot,
  handlingUnit,
  holdLocation: location,
});
assert.equal(sourceHash, verificationSourceSnapshotHash({
  batch,
  material,
  lot,
  handlingUnit,
  holdLocation: location,
}));
assert.notEqual(sourceHash, verificationSourceSnapshotHash({
  batch,
  material,
  lot,
  handlingUnit: { ...handlingUnit, quantity: 99 },
  holdLocation: location,
}));

const requestHash = inventoryObservationRequestHash({ caseId, actorId: "USER-1", observation: parsed });
assert.notEqual(
  requestHash,
  inventoryObservationRequestHash({ caseId, actorId: "USER-2", observation: parsed }),
  "인증된 제출자도 멱등 hash에 포함되어야 함",
);

console.log("✅ inventory verification rules passed");
