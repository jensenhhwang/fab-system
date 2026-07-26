import assert from "node:assert/strict";
import type {
  HandlingUnitDoc,
  InventoryDoc,
  InventoryLotDoc,
  MaterialDoc,
  StorageLocationDoc,
  TransferOrderDoc,
  WorkOrderDoc,
} from "../src/lib/db";
import {
  buildOpeningReconciliationPlan,
  reconciliationHoldLocationId,
} from "../src/lib/inventory-physical-reconciliation";

const now = new Date("2026-07-26T00:00:00.000Z");

function material(id: string): MaterialDoc {
  return {
    _id: id,
    code: id,
    name: id,
    category: "CSM",
    unit: "개",
    safetyStock: 0,
    ropDays: 30,
  };
}

function inventory(materialId: string, quantity: number): InventoryDoc {
  return {
    _id: `${materialId}__MWH-01`,
    materialId,
    warehouseId: "MWH-01",
    quantity,
    avgDailyUsage: 0,
  };
}

function location(id: string, warehouseId = "MWH-01"): StorageLocationDoc {
  return {
    _id: id,
    warehouseId,
    zoneId: `${warehouseId}__ZONE`,
    code: id,
    locationType: "PALLET",
    capacity: 100,
    status: "AVAILABLE",
    position: { x: 0, y: 0, z: 0 },
  };
}

function lot(id: string, materialId: string, availableQuantity: number): InventoryLotDoc {
  return {
    _id: id,
    materialId,
    lotNo: id,
    quantity: availableQuantity,
    availableQuantity,
    receivedAt: now,
    qualityStatus: "AVAILABLE",
    warehouseId: "MWH-01",
    slotId: "LOC-1",
    updatedAt: now,
  };
}

function hu(input: Partial<HandlingUnitDoc> & Pick<HandlingUnitDoc, "_id" | "inventoryLotId" | "materialId" | "quantity">): HandlingUnitDoc {
  return {
    warehouseId: "MWH-01",
    locationId: "LOC-1",
    containerType: "MODELED",
    status: "AVAILABLE",
    updatedAt: now,
    ...input,
  };
}

function plan(input: {
  materials?: MaterialDoc[];
  inventory?: InventoryDoc[];
  lots?: InventoryLotDoc[];
  handlingUnits?: HandlingUnitDoc[];
  locations?: StorageLocationDoc[];
  transfers?: TransferOrderDoc[];
  workOrders?: WorkOrderDoc[];
}) {
  return buildOpeningReconciliationPlan({
    materials: input.materials ?? [material("MAT-1")],
    inventory: input.inventory ?? [inventory("MAT-1", 100)],
    lots: input.lots ?? [],
    handlingUnits: input.handlingUnits ?? [],
    locations: input.locations ?? [location("LOC-1")],
    transfers: input.transfers ?? [],
    workOrders: input.workOrders ?? [],
  });
}

{
  const result = plan({});
  assert.equal(result.blocks.length, 0);
  assert.equal(result.openingPositions.length, 1);
  assert.equal(result.openingPositions[0].quantity, 100);
  assert.equal(result.openingPositions[0].warehouseId, "MWH-01");
  assert.equal(reconciliationHoldLocationId("MWH-01"), "RECON-HOLD__MWH-01");
}

{
  const result = plan({
    lots: [lot("LOT-1", "MAT-1", 40)],
    handlingUnits: [hu({ _id: "HU-1", inventoryLotId: "LOT-1", materialId: "MAT-1", quantity: 10 })],
  });
  assert.equal(result.blocks.length, 0);
  assert.equal(result.fillHandlingUnits[0].quantity, 30);
  assert.equal(result.openingPositions[0].quantity, 60);
  assert.equal(result.summaries[0].lotPhysicalAfter, 100);
  assert.equal(result.summaries[0].huPhysicalAfter, 100);
}

{
  const reserved = hu({
    _id: "HU-R",
    inventoryLotId: "LOT-1",
    materialId: "MAT-1",
    quantity: 30,
    logisticsStatus: "RESERVED",
    reservedTransferOrderId: "TO-1",
    reservedWorkOrderId: "WO-1",
  });
  const transfer: TransferOrderDoc = {
    _id: "TO-1",
    allocationId: "A-1",
    materialId: "MAT-1",
    fabId: "M20",
    quantity: 30,
    unit: "개",
    fromFacilityId: "MWH-01",
    toFacilityId: "FAB-M20",
    lotId: "LOT-1",
    handlingUnitId: "HU-R",
    workOrderId: "WO-1",
    status: "PICKING",
    createdAt: now,
    updatedAt: now,
  };
  const workOrder: WorkOrderDoc = {
    _id: "WO-1",
    fabId: "M20",
    processCode: "P10",
    product: "HBM",
    plannedQty: 1,
    status: "RUNNING",
    bomLines: [],
    createdBy: "TEST",
    createdAt: now,
    updatedAt: now,
  };
  const result = plan({
    inventory: [inventory("MAT-1", 100)],
    lots: [lot("LOT-1", "MAT-1", 70)],
    handlingUnits: [
      hu({ _id: "HU-F", inventoryLotId: "LOT-1", materialId: "MAT-1", quantity: 70 }),
      reserved,
    ],
    transfers: [transfer],
    workOrders: [workOrder],
  });
  assert.equal(result.blocks.length, 0);
  assert.equal(result.fillHandlingUnits.length, 0);
  assert.equal(result.openingPositions.length, 0);
  assert.equal(result.summaries[0].lotPhysicalBefore, 100);
}

{
  const orphan = hu({
    _id: "HU-ORPHAN",
    inventoryLotId: "LOT-MISSING",
    materialId: "MAT-1",
    quantity: 25,
  });
  const result = plan({ handlingUnits: [orphan] });
  assert.equal(result.blocks.length, 0);
  assert.equal(result.recoveryLots.length, 1);
  assert.equal(result.recoveryLots[0].lotId, "LOT-MISSING");
  assert.equal(result.recoveryLots[0].quantity, 25);
  assert.equal(result.openingPositions[0].quantity, 75);
}

{
  const result = plan({
    materials: [material("CSM-016")],
    inventory: [inventory("CSM-016", 0)],
  });
  assert.equal(result.blocks.length, 0);
  assert.equal(result.openingPositions.length, 0);
  assert.equal(result.summaries[0].status, "SKIPPED_UNCALIBRATED_ZERO_BASELINE");
}

{
  const result = plan({
    materials: [material("CSM-016")],
    inventory: [inventory("CSM-016", 1)],
  });
  assert.equal(result.blocks[0].code, "UNCALIBRATED_NONZERO_PHYSICAL");
}

{
  const result = plan({
    lots: [lot("LOT-1", "MAT-1", 10)],
    handlingUnits: [hu({ _id: "HU-1", inventoryLotId: "LOT-1", materialId: "MAT-1", quantity: 20 })],
  });
  assert.equal(result.blocks[0].code, "HU_EXCEEDS_LOT_PHYSICAL");
}

{
  const result = plan({
    lots: [lot("LOT-1", "MAT-1", 10)],
    handlingUnits: [hu({
      _id: "HU-OUT",
      inventoryLotId: "LOT-1",
      materialId: "MAT-1",
      quantity: 10,
      logisticsStatus: "IN_TRANSIT",
      currentFacilityId: "IN_TRANSIT",
      currentLocationId: "TO-1",
    })],
  });
  assert.equal(result.blocks.length, 0);
  assert.equal(result.fillHandlingUnits[0].quantity, 10);
}

console.log("✅ inventory physical reconciliation rules passed");
