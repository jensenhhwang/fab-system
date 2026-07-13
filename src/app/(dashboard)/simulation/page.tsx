export const dynamic = "force-dynamic";

import { getInventoryRows, getProcessUsagesWithMaterial, getWarehouseCapacity } from "@/lib/queries";
import OperationalScenarioClient from "./OperationalScenarioClient";
import SimControlPanel from "./SimControlPanel";
import type { ScenarioMaterial } from "@/lib/scenario-engine";
import { materialFactor } from "@/lib/capacity";

export default async function ScenarioPage() {
  const [rows, usages, warehouses] = await Promise.all([getInventoryRows(true), getProcessUsagesWithMaterial(), getWarehouseCapacity()]);
  const productMap = new Map<string, { HBM: number; DRAM: number; NAND: number }>();
  for (const usage of usages) {
    const value = productMap.get(usage.materialId) ?? { HBM: 0, DRAM: 0, NAND: 0 };
    value[usage.product] += usage.monthlyQty / 30;
    productMap.set(usage.materialId, value);
  }
  const seen = new Set<string>();
  const materials: ScenarioMaterial[] = [];
  for (const row of rows) {
    if (seen.has(row.materialId)) continue;
    seen.add(row.materialId);
    materials.push({
      id: row.materialId, code: row.material.code, name: row.material.name, category: row.material.category, unit: row.material.unit,
      currentQuantity: row.totalQuantity, baseDailyUsage: row.dailyUsage, ropDays: row.material.ropDays,
      productDailyUsage: productMap.get(row.materialId) ?? { HBM: 0, DRAM: 0, NAND: 0 },
      warehouseCode: row.warehouse.code, warehouseName: row.warehouse.name,
      occupancyFactor: ["HAZMAT", "MRO", "PRECURSOR"].includes(row.warehouse.type) ? 1 : materialFactor(row.material),
    });
  }
  const processUsages = usages.map((usage) => ({ materialId: usage.materialId, materialName: usage.material.name, processCode: usage.processCode, product: usage.product, monthlyQty: usage.monthlyQty }));
  const warehouseData = warehouses.map((warehouse) => ({ code: warehouse.code, name: warehouse.name, occupancy: warehouse.occupancy, totalCapacity: warehouse.totalCapacity, utilization: warehouse.utilization }));
  return (
    <>
      <div className="mb-6">
        <SimControlPanel />
      </div>
      <OperationalScenarioClient materials={materials} processUsages={processUsages} warehouses={warehouseData} snapshotAt={new Date().toISOString()} />
    </>
  );
}
