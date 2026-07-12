export const dynamic = "force-dynamic";

import { getProcessUsagesWithMaterial, getInventoryRows, getWarehouseCapacity, getWarehouses } from "@/lib/queries";
import MarketSimClient from "./MarketSimClient";

async function getSimData() {
  const [usages, inventories, capacities, warehouses] = await Promise.all([
    getProcessUsagesWithMaterial(),
    getInventoryRows(),
    getWarehouseCapacity(),
    getWarehouses(),
  ]);

  // materialId → warehouseCode
  const matToWh = new Map<string, string>();
  for (const inv of inventories) {
    if (!matToWh.has(inv.materialId)) matToWh.set(inv.materialId, inv.warehouse.code);
  }

  // 공정별 소비량 집계 (product × processCode × monthlyQty)
  type ProcUsage = { procCode: string; product: string; monthlyQty: number; category: string; whCode: string };
  const procUsages: ProcUsage[] = usages.map((u) => ({
    procCode: u.processCode,
    product: u.product,
    monthlyQty: u.monthlyQty,
    category: u.material.category,
    whCode: matToWh.get(u.materialId) ?? "WH-A",
  }));

  // 창고별 현황 (capacity 기준)
  const capMap = new Map(capacities.map((c) => [c.code, c]));
  const whData = warehouses.map((w) => {
    const cap = capMap.get(w.code);
    return {
      code: w.code,
      name: w.name,
      totalCapacity: w.totalCapacity,
      utilization: cap?.utilization ?? 0,
      byCategory: cap?.byCategory ?? [],
    };
  });

  return { procUsages, whData };
}

export default async function MarketSimPage() {
  const data = await getSimData();
  return <MarketSimClient {...data} />;
}
