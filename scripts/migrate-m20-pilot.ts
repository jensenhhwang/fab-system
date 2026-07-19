import "dotenv/config";
import { collections } from "../src/lib/db";
import type { HandlingUnitDoc, StorageLocationDoc, WarehouseZoneDoc } from "../src/lib/db";

async function main() {
  const {
    warehouseZones, storageLocations, inventoryLots, handlingUnits,
    fabMaterialStocks, materialFlowEvents, transferOrders,
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

  await Promise.all([
    fabMaterialStocks.createIndex({ fabId: 1, processCode: 1, locationType: 1, materialId: 1 }, { unique: true }),
    handlingUnits.createIndex({ reservedTransferOrderId: 1 }, { sparse: true }),
    transferOrders.createIndex({ workOrderId: 1, materialId: 1, status: 1 }),
    materialFlowEvents.createIndex({ requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } }),
  ]);
  console.log(`✅ M20 P10 pilot material flow ready: lot=${lot._id}; equipment는 db:migrate-m20-equipment-master에서 별도 관리`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
