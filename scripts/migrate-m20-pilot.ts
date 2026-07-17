import "dotenv/config";
import { collections } from "../src/lib/db";
import type { EquipmentMasterDoc, HandlingUnitDoc, StorageLocationDoc, WarehouseZoneDoc } from "../src/lib/db";
import { PROCESSES } from "../src/lib/processes";

const M20_EQUIPMENT_COUNTS: Record<string, number> = {
  P01: 32, P02: 48, P03: 64, P04: 72, P05: 24,
  P06: 48, P07: 32, P08: 56, P09: 40, P10: 36,
};

const RATED_CAPACITY: Record<string, number> = {
  P01: 115, P02: 105, P03: 92, P04: 108, P05: 120,
  P06: 105, P07: 98, P08: 86, P09: 130, P10: 140,
};

async function main() {
  const {
    warehouseZones, storageLocations, inventoryLots, handlingUnits,
    fabMaterialStocks, equipmentMaster, materialFlowEvents, transferOrders,
  } = await collections();
  const now = new Date();
  const zone: WarehouseZoneDoc = {
    _id: "MWH-02__M20-PILOT-ZONE",
    warehouseId: "MWH-02",
    code: "M20-PILOT",
    name: "M20 대표자재 보관·출고",
    zoneType: "FLAT",
    accessLevel: "STANDARD",
  };
  await warehouseZones.updateOne({ _id: zone._id }, { $set: zone }, { upsert: true });

  const locations: StorageLocationDoc[] = [
    {
      _id: "MWH-02__M20-PILOT-STORAGE", warehouseId: "MWH-02", zoneId: zone._id,
      code: "M20-PILOT-STORAGE", locationType: "PALLET", capacity: 2, status: "OCCUPIED",
      position: { x: 0, y: 0, z: 0 },
    },
    {
      _id: "MWH-02__M20-PILOT-OUTBOUND", warehouseId: "MWH-02", zoneId: zone._id,
      code: "M20-PILOT-OUTBOUND", locationType: "PROCESS", capacity: 2, status: "AVAILABLE",
      position: { x: 4, y: 0, z: 0 },
    },
  ];
  for (const location of locations) {
    await storageLocations.updateOne({ _id: location._id }, { $set: location }, { upsert: true });
  }

  const lot = await inventoryLots.findOne({
    materialId: "PKG-001",
    qualityStatus: "AVAILABLE",
    availableQuantity: { $gte: 98 },
    simulated: { $ne: true },
  }, { sort: { expiryDate: 1, receivedAt: 1 } });
  if (!lot) throw new Error("M20 대표 흐름에 필요한 PKG-001 가용 Lot 98kg가 없습니다.");
  const existingUnits = await handlingUnits.find({ inventoryLotId: lot._id }).toArray();
  if (!existingUnits.length) {
    const units: HandlingUnitDoc[] = [
      {
        _id: `HU__${lot._id}__M20-PILOT`, inventoryLotId: lot._id, materialId: lot.materialId,
        warehouseId: "MWH-02", locationId: locations[0]._id, containerType: "PALLET", quantity: 98,
        status: "AVAILABLE", logisticsStatus: "STORED", currentFacilityId: "MWH-02",
        currentLocationId: locations[0]._id, version: 0, updatedAt: now,
      },
    ];
    const remainder = Math.round((lot.availableQuantity - 98) * 100) / 100;
    if (remainder > 0) units.push({
      _id: `HU__${lot._id}__REMAINDER`, inventoryLotId: lot._id, materialId: lot.materialId,
      warehouseId: "MWH-02", locationId: locations[0]._id, containerType: "PALLET", quantity: remainder,
      status: "AVAILABLE", logisticsStatus: "STORED", currentFacilityId: "MWH-02",
      currentLocationId: locations[0]._id, version: 0, updatedAt: now,
    });
    await handlingUnits.insertMany(units);
    await inventoryLots.updateOne({ _id: lot._id }, { $set: { warehouseId: "MWH-02", slotId: locations[0]._id, updatedAt: now } });
  }

  for (const locationType of ["PRS", "LINE_SIDE"] as const) {
    const locationId = locationType === "PRS" ? "FAB-M20__PRS-P10" : "FAB-M20__LINE-P10";
    await fabMaterialStocks.updateOne(
      { _id: `M20__P10__${locationType}__PKG-001` },
      { $setOnInsert: { fabId: "M20", processCode: "P10", locationType, locationId, materialId: "PKG-001", quantity: 0, unit: "kg" }, $set: { updatedAt: now } },
      { upsert: true },
    );
  }

  const equipment: EquipmentMasterDoc[] = [];
  for (const [processIndex, process] of PROCESSES.entries()) {
    const count = M20_EQUIPMENT_COUNTS[process.code] ?? 0;
    for (let index = 0; index < count; index += 1) {
      const sequence = index + 1;
      const stateSelector = sequence % 100;
      const status = stateSelector < 90 ? "RUN" : stateSelector < 95 ? "IDLE" : stateSelector < 98 ? "PM" : "DOWN";
      equipment.push({
        _id: `M20-${process.code}-${String(sequence).padStart(3, "0")}`,
        fabId: "M20",
        processCode: process.code,
        model: `${process.nameEn.toUpperCase().replaceAll(" ", "-")}-M20`,
        bay: `M20-${process.code}-B${String(Math.floor(index / 12) + 1).padStart(2, "0")}`,
        position: { x: (index % 12) - 5.5, y: 0, z: processIndex * 4 + Math.floor(index / 12) * 0.55 },
        status,
        ratedCapacity: RATED_CAPACITY[process.code] ?? 100,
        capacityUnit: "WAFER_DAY",
        oee: Math.round((0.82 + (sequence % 8) * 0.01) * 100) / 100,
        source: "MODELED_BASELINE",
        updatedAt: now,
      });
    }
  }
  for (const tool of equipment) {
    await equipmentMaster.updateOne({ _id: tool._id }, { $set: tool }, { upsert: true });
  }

  await Promise.all([
    equipmentMaster.createIndex({ fabId: 1, processCode: 1, status: 1 }),
    fabMaterialStocks.createIndex({ fabId: 1, processCode: 1, locationType: 1, materialId: 1 }, { unique: true }),
    handlingUnits.createIndex({ reservedTransferOrderId: 1 }, { sparse: true }),
    transferOrders.createIndex({ workOrderId: 1, materialId: 1, status: 1 }),
    materialFlowEvents.createIndex({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } }),
  ]);
  console.log(`✅ M20 pilot master ready: lot=${lot._id}, equipment=${equipment.length}, modeled baseline`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
