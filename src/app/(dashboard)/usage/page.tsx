export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { getUsageTwinData } from "@/lib/usage-twin-data";
import UsageClient from "./UsageClient";
import { getEquipmentCapacity } from "@/lib/equipment-capacity";
import { FAB_IDS, type FabId } from "@/lib/fab-domain";
import { buildM20FabEquipmentMaster } from "@/lib/m20-equipment-capacity-plan";
import { buildM21FabEquipmentMaster } from "@/lib/m21-equipment-capacity-plan";
import { buildM22FabEquipmentMaster } from "@/lib/m22-equipment-capacity-plan";

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
  const equipmentMasterByFab = {
    M20: buildM20FabEquipmentMaster(),
    M21: buildM21FabEquipmentMaster(),
    M22: buildM22FabEquipmentMaster(),
  };
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">로딩 중...</div>}>
      <UsageClient materials={data.materials} warehouseLinks={data.links} warehouses={data.warehouses} equipmentByFab={equipmentByFab} equipmentMasterByFab={equipmentMasterByFab} />
    </Suspense>
  );
}
