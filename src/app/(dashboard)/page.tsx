export const dynamic = "force-dynamic";

import ControlTowerClient from "@/components/ControlTowerClient";
import OperationsImprovementInbox from "@/components/OperationsImprovementInbox";
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

  return (
    <div className="space-y-6">
      <ControlTowerClient snapshot={snapshot} warehouseUtilization={warehouseUtilization} />
      <OperationsImprovementInbox />
    </div>
  );
}
