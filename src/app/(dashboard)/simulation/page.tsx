export const dynamic = "force-dynamic";

import { getInventoryRows, getProcessUsagesWithMaterial } from "@/lib/queries";
import SimulationClient, { type SimMaterial, type AffectedProcess } from "./SimulationClient";

async function getSimulationData() {
  const [rows, processUsages] = await Promise.all([
    getInventoryRows(true),
    getProcessUsagesWithMaterial(),
  ]);

  // 자재별 중복 제거 (totalQuantity는 모든 row에 동일하게 계산됨)
  const seen = new Set<string>();
  const materials: SimMaterial[] = [];
  for (const row of rows) {
    if (seen.has(row.materialId)) continue;
    seen.add(row.materialId);
    materials.push({
      id: row.materialId,
      code: row.material.code,
      name: row.material.name,
      category: row.material.category,
      unit: row.material.unit,
      totalQuantity: row.totalQuantity,
      dailyUsage: row.dailyUsage,
      doh: row.doh,
      ropDays: row.material.ropDays,
    });
  }

  const affectedProcesses: AffectedProcess[] = processUsages.map((p) => ({
    materialId: p.materialId,
    processCode: p.processCode,
    product: p.product,
    monthlyQty: p.monthlyQty,
  }));

  return { materials, affectedProcesses };
}

export default async function Page() {
  const { materials, affectedProcesses } = await getSimulationData();

  return (
    <>
      <div className="mb-1 text-2xl font-extrabold tracking-tight">입고 시뮬레이션</div>
      <div className="text-sm text-[#999] mb-8">자재 선택 → A/B안 입고 수량 입력 → DOH 변화 예측</div>
      <SimulationClient materials={materials} processUsages={affectedProcesses} />
    </>
  );
}
