export const dynamic = "force-dynamic";

import ControlTowerClient from "@/components/ControlTowerClient";
import { buildControlTowerSnapshot } from "@/lib/control-tower";
import {
  getInventoriesWithRefs,
  getProcessUsagesWithMaterial,
  getWarehouseCapacity,
} from "@/lib/queries";

export default async function DashboardPage() {
  const [inventories, usages, warehouses] = await Promise.all([
    getInventoriesWithRefs(true),
    getProcessUsagesWithMaterial(),
    getWarehouseCapacity(),
  ]);
  const snapshot = buildControlTowerSnapshot(inventories, usages);
  const warehouseUtilization = warehouses.length
    ? Math.round(warehouses.reduce((sum, warehouse) => sum + Math.min(warehouse.utilization, 100), 0) / warehouses.length)
    : 0;

  return <ControlTowerClient snapshot={snapshot} warehouseUtilization={warehouseUtilization} />;
}
