import "dotenv/config";
import { collections } from "../src/lib/db";

async function main() {
  const {
    bomTemplates, workOrders, materials, inventory, inventoryLots, handlingUnits,
    materialAllocations, transferOrders, materialFlowEvents, processMetadata, fabMaterialStocks, equipmentMaster,
  } = await collections();
  const [templates, orders, allocations, transfers, events, processes] = await Promise.all([
    bomTemplates.find({ product: "HBM", "lines.0": { $exists: true } }).sort({ processCode: 1 }).toArray(),
    workOrders.find({ fabId: "M20" }).sort({ createdAt: -1 }).limit(10).toArray(),
    materialAllocations.find({ fabId: "M20" }).sort({ updatedAt: -1 }).limit(20).toArray(),
    transferOrders.find({ fabId: "M20" }).sort({ updatedAt: -1 }).limit(20).toArray(),
    materialFlowEvents.find({ fabId: "M20" }).sort({ occurredAt: -1 }).limit(20).toArray(),
    processMetadata.find({}).sort({ sequence: 1 }).toArray(),
  ]);
  const materialIds = [...new Set(templates.flatMap((template) => template.lines.map((line) => line.materialId)))];
  const [materialDocs, inventoryDocs, lotDocs, huDocs, fabStocks, equipmentCount] = await Promise.all([
    materials.find({ _id: { $in: materialIds } }).toArray(),
    inventory.find({ materialId: { $in: materialIds }, quantity: { $gt: 0 } }).toArray(),
    inventoryLots.find({ materialId: { $in: materialIds }, qualityStatus: "AVAILABLE", availableQuantity: { $gt: 0 }, simulated: { $ne: true } }).sort({ expiryDate: 1, receivedAt: 1 }).toArray(),
    handlingUnits.find({ materialId: { $in: materialIds } }).toArray(),
    fabMaterialStocks.find({ fabId: "M20" }).toArray(),
    equipmentMaster.countDocuments({ fabId: "M20" }),
  ]);
  const materialMap = new Map(materialDocs.map((material) => [material._id, material]));
  const huByLot = new Map(huDocs.map((unit) => [unit.inventoryLotId, unit]));
  const candidates = lotDocs.map((lot) => {
    const unit = huByLot.get(lot._id);
    return {
      materialId: lot.materialId,
      materialCode: materialMap.get(lot.materialId)?.code,
      lotId: lot._id,
      warehouseId: lot.warehouseId,
      locationId: lot.slotId,
      lotAvailable: lot.availableQuantity,
      handlingUnitId: unit?._id ?? null,
      handlingUnitQuantity: unit?.quantity ?? null,
      expiryDate: lot.expiryDate?.toISOString() ?? null,
    };
  });
  console.log(JSON.stringify({
    templates: templates.map((template) => ({ id: template._id, processCode: template.processCode, lineCount: template.lines.length, sampleLines: template.lines.slice(0, 3) })),
    candidates: candidates.slice(0, 20),
    pilotHandlingUnits: huDocs.filter((unit) => unit.materialId === "PKG-001").map((unit) => ({
      id: unit._id, lotId: unit.inventoryLotId, quantity: unit.quantity, status: unit.status,
      logisticsStatus: unit.logisticsStatus, currentLocationId: unit.currentLocationId,
      reservedTransferOrderId: unit.reservedTransferOrderId, version: unit.version,
    })),
    inventory: inventoryDocs.map((row) => ({ materialId: row.materialId, warehouseId: row.warehouseId, quantity: row.quantity })),
    existing: { workOrders: orders.length, allocations: allocations.length, transfers: transfers.length, events: events.length },
    latestWorkOrders: orders.map((order) => ({ id: order._id, processCode: order.processCode, status: order.status, bomLines: order.bomLines })),
    latestTransfers: transfers.map((transfer) => ({ id: transfer._id, workOrderId: transfer.workOrderId, status: transfer.status, materialId: transfer.materialId, lotId: transfer.lotId, handlingUnitId: transfer.handlingUnitId, version: transfer.version })),
    latestEvents: events.map((event) => ({ id: event._id, workOrderId: event.workOrderId, type: event.type, requestId: event.requestId, sequence: event.sequence })),
    fabStocks: fabStocks.map((stock) => ({ id: stock._id, locationType: stock.locationType, materialId: stock.materialId, quantity: stock.quantity, unit: stock.unit })),
    equipmentCount,
    processMetadata: processes.map((process) => ({ code: process._id, name: process.name, sequence: process.sequence })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
