import "dotenv/config";
import { MongoClient } from "mongodb";
import { buildVirtualWarehouseLayout, type WarehouseInventoryInput } from "../src/lib/warehouse-layout";

const apply = process.argv.includes("--apply");
const uri = process.env.DATABASE_URL;
if (!uri) throw new Error("DATABASE_URL 미설정");
const client = new MongoClient(uri);

async function main() {
  await client.connect();
  const db = client.db();
  const warehouses = await db.collection<{ _id: string; code: string; type: string }>("warehouses").find({}).toArray();
  const materials = await db.collection<{ _id: string; code: string; name: string; category: string; unit: string; ropDays: number }>("materials").find({}).toArray();
  const inventory = await db.collection<{ _id: string; materialId: string; warehouseId: string; quantity: number; avgDailyUsage: number; status?: "AVAILABLE" | "HOLD" | "QUARANTINE" }>("inventory").find({}).toArray();
  const materialMap = new Map(materials.map((material) => [material._id, material]));
  const zoneDocs: Record<string, unknown>[] = [];
  const locationDocs: Record<string, unknown>[] = [];
  const lotDocs: Record<string, unknown>[] = [];
  const handlingDocs: Record<string, unknown>[] = [];
  const telemetryDocs: Record<string, unknown>[] = [];

  for (const warehouse of warehouses) {
    const inputs: WarehouseInventoryInput[] = inventory.filter((item) => item.warehouseId === warehouse._id).map((item) => {
      const material = materialMap.get(item.materialId);
      if (!material) throw new Error(`자재 마스터 누락: ${item.materialId}`);
      return { materialId: item.materialId, quantity: item.quantity, dailyUsage: item.avgDailyUsage, doh: item.avgDailyUsage > 0 ? item.quantity / item.avgDailyUsage : null, status: item.status,
        material: { code: material.code, name: material.name, category: material.category, unit: material.unit } };
    });
    const layout = buildVirtualWarehouseLayout(warehouse.code, warehouse.type, inputs);
    const zones = [...new Set(layout.map((location) => location.zone))];
    for (const [zoneIndex, zone] of zones.entries()) {
      zoneDocs.push({ _id: `${warehouse._id}__Z${zoneIndex + 1}`, warehouseId: warehouse._id, code: `Z${zoneIndex + 1}`, name: zone, zoneType: warehouse.type, accessLevel: warehouse.type === "HAZMAT" ? "RESTRICTED" : "STANDARD" });
    }
    const zoneIdByName = new Map(zones.map((zone, index) => [zone, `${warehouse._id}__Z${index + 1}`]));
    for (const location of layout) {
      const locationType = warehouse.type === "HAZMAT" ? "CYLINDER" : warehouse.type === "MRO" ? "BIN" : warehouse.type === "BULK_GAS" || warehouse.type === "BULK_CHEM" ? "TANK" : warehouse.type === "PRECURSOR" ? "CANISTER" : warehouse.type === "ON_SITE" ? "PROCESS" : "PALLET";
      locationDocs.push({ _id: location.id, warehouseId: warehouse._id, zoneId: zoneIdByName.get(location.zone), code: location.code, aisle: location.aisle, bay: location.bay, level: location.level,
        locationType, capacity: 1, status: location.materialId ? "OCCUPIED" : "AVAILABLE", position: { x: location.position[0], y: location.position[1], z: location.position[2] } });
      if (!location.materialId || location.quantity == null) continue;
      const lotId = `LOT__${location.materialId}__001`;
      const handlingId = `HU__${location.materialId}__001`;
      const receivedAt = new Date("2026-06-15T00:00:00.000Z");
      lotDocs.push({ _id: lotId, materialId: location.materialId, lotNo: `${location.materialCode}-260615-A`, quantity: location.quantity, availableQuantity: location.quantity,
        receivedAt, expiryDate: new Date("2027-06-15T00:00:00.000Z"), qualityStatus: location.status === "HOLD" || location.status === "QUARANTINE" ? location.status : "AVAILABLE", updatedAt: new Date() });
      handlingDocs.push({ _id: handlingId, inventoryLotId: lotId, materialId: location.materialId, warehouseId: warehouse._id, locationId: location.id,
        containerType: locationType, quantity: location.quantity, status: location.status === "HOLD" || location.status === "QUARANTINE" ? location.status : "AVAILABLE", updatedAt: new Date() });
    }
    const metric = warehouse.type === "BULK_GAS" || warehouse.type === "BULK_CHEM" ? "LEVEL" : warehouse.type === "ON_SITE" ? "UPW_RESISTIVITY" : "TEMPERATURE";
    telemetryDocs.push({ _id: `${warehouse._id}__${metric}`, warehouseId: warehouse._id, metric,
      value: metric === "LEVEL" ? 68 : metric === "UPW_RESISTIVITY" ? 18.1 : warehouse.type === "HAZMAT" ? 18.2 : 22.4,
      unit: metric === "LEVEL" ? "%" : metric === "UPW_RESISTIVITY" ? "MΩ·cm" : "°C", status: "NORMAL", measuredAt: new Date() });
  }

  console.log(`[warehouse-ops] mode=${apply ? "APPLY" : "DRY-RUN"} zones=${zoneDocs.length} locations=${locationDocs.length} lots=${lotDocs.length} handlingUnits=${handlingDocs.length} telemetry=${telemetryDocs.length}`);
  if (!apply) return;
  const sets = [
    ["warehouseZones", zoneDocs], ["storageLocations", locationDocs], ["inventoryLots", lotDocs], ["handlingUnits", handlingDocs], ["facilityTelemetry", telemetryDocs],
  ] as const;
  for (const [name, docs] of sets) {
    const collection = db.collection<{ _id: string } & Record<string, unknown>>(name);
    for (const doc of docs) await collection.updateOne({ _id: doc._id as string }, { $set: doc }, { upsert: true });
  }
  console.log("운영 위치·로트·용기 데이터 적용 완료");
}

main().finally(() => client.close());
