export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { getUsageTwinData } from "@/lib/usage-twin-data";
import UsageClient from "./UsageClient";
import { getEquipmentCapacity } from "@/lib/equipment-capacity";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";

// Fab·공정·자재별 계획과 실제 소비를 비교하는 독립 분석 화면.
export default async function UsagePage() {
  const [data, ...equipmentRows] = await Promise.all([
    getUsageTwinData(),
    ...FAB_IDS.map((fabId) => getEquipmentCapacity(fabId)),
  ]);
  const equipmentByFab = Object.fromEntries(FAB_IDS.map((fabId, index) => [
    fabId,
    Object.fromEntries(equipmentRows[index].map((process) => [process.processCode, process.total])),
  ])) as Record<FabId, Record<string, number>>;
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">로딩 중...</div>}>
      <UsageClient materials={data.materials} warehouseLinks={data.links} warehouses={data.warehouses} equipmentByFab={equipmentByFab} />
    </Suspense>
  );
}
