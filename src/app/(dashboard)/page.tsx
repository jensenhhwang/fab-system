export const dynamic = "force-dynamic";

import ControlTowerLiveClient from "@/components/ControlTowerLiveClient";
import ControlTowerAskPanel from "@/components/ControlTowerAskPanel";
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

      <section>
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-[#F0EEEB] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-[#6F6963]">관제탑 라이브</span>
          <span className="text-[11px] text-[#999]">Twin이 실제로 돌면서 M20 4-에이전트(김구매·이자재·최생산·박물류)가 판단하는 실시간 화면</span>
        </div>
        <ControlTowerLiveClient />
        <ControlTowerAskPanel />
        <OperationsImprovementInbox />
      </section>
    </div>
  );
}
