export const dynamic = "force-dynamic";

import { collections } from "@/lib/db";
import { getInventoriesWithRefs, getProcessUsagesWithMaterial } from "@/lib/queries";
import { buildControlTowerSnapshot } from "@/lib/control-tower";
import { buildCampusMaterialFlowSnapshot } from "@/lib/material-flow";
import { getUsageTwinData } from "@/lib/usage-twin-data";
import { getLiveTransfers } from "@/lib/live-transfer-query";
import { getEquipmentCapacity } from "@/lib/equipment-capacity";
import CampusClient from "./CampusClient";

export default async function CampusPage() {
  const { inventoryLots, handlingUnits, materialAllocations, materialFlowEvents } = await collections();
  const [inventories, usages, lots, units, allocations, events, usageTwin, liveTransfers, m20Equipment] = await Promise.all([
    getInventoriesWithRefs(true),
    getProcessUsagesWithMaterial(),
    inventoryLots.find({ simulated: { $ne: true } }).toArray(),
    handlingUnits.find({}).toArray(),
    materialAllocations.find({ status: { $ne: "CANCELLED" } }).toArray(),
    materialFlowEvents.find({}).sort({ occurredAt: -1 }).limit(10_000).toArray(),
    getUsageTwinData(),
    getLiveTransfers(),
    getEquipmentCapacity("M20"),
  ]);
  const controlTower = buildControlTowerSnapshot(inventories, usages);
  const snapshot = buildCampusMaterialFlowSnapshot(controlTower, inventories, usages, lots, units, allocations, events);
  return <CampusClient snapshot={snapshot} usageTwin={usageTwin} initialTransfers={liveTransfers} equipmentCounts={{ M20: Object.fromEntries(m20Equipment.map((process) => [process.processCode, process.total])) }} />;
}
