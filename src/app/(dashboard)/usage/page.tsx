export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { getUsageTwinData } from "@/lib/usage-twin-data";
import UsageClient from "./UsageClient";
import { getEquipmentCapacity } from "@/lib/equipment-capacity";

// 공정 학습·자재 비교를 위한 독립 화면은 유지하고,
// 동일한 공정 3D 모델을 Campus Twin의 Fab 상세에서도 재사용한다.
export default async function UsagePage() {
  const [data, m20Equipment] = await Promise.all([getUsageTwinData(), getEquipmentCapacity("M20")]);
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">로딩 중...</div>}>
      <UsageClient materials={data.materials} warehouseLinks={data.links} warehouses={data.warehouses} equipmentCounts={Object.fromEntries(m20Equipment.map((process) => [process.processCode, process.total]))} />
    </Suspense>
  );
}
