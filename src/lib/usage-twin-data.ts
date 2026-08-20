import { getInventoryRows, getProcessUsagesWithMaterial, getWarehouseCapacity, getWarehouses } from "@/lib/queries";
import { collections } from "@/lib/db";
import { getOrInitTwinState } from "@/lib/twin/state";
import { operatingDaysToMs, OPERATING_DAYS_PER_MONTH } from "@/lib/twin/operating-clock";

export type UsageTwinMaterial = {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string;
  processes: string[];
  products: string[];
  usages: { proc: string; product: string; qty: number; actualQty: number }[];
  inventory: { quantity: number; dailyUsage: number; doh: number | null; unit: string } | null;
};

export type UsageWarehouseLink = { whCode: string; procCode: string; qty: number; category: string };
export type UsageWarehouse = {
  code: string; name: string; type: string; categories: string[];
  processCount: number; totalQty: number; utilization: number;
  byCategory: { category: string; pct: number }[];
};

export type UsageTwinData = {
  materials: UsageTwinMaterial[];
  links: UsageWarehouseLink[];
  warehouses: UsageWarehouse[];
};

export async function getUsageTwinData(): Promise<UsageTwinData> {
  const { twinBurnEvents } = await collections();
  // 창은 **운영 30일**이다 — 비교 대상인 monthlyQty가 운영 1개월치이기 때문이다. 예전에는
  // 30 벽시계일(= 운영 720일 = 24개월)을 모아 1개월 설계치와 나란히 놓고 usageGap을 계산했다.
  // 소스도 materialFlowEvents에서 twinBurnEvents로 옮긴다 — 전자는 2026-07-27 이후 적재가
  // 끊겨 실적이 사실상 0이었다.
  const twinState = await getOrInitTwinState();
  const sinceOperatingMs = Math.max(0, (twinState.operatingEpochMs ?? 0) - operatingDaysToMs(OPERATING_DAYS_PER_MONTH));
  const [usages, inventories, warehouses, capacities, consumptionEvents] = await Promise.all([
    getProcessUsagesWithMaterial(),
    getInventoryRows(),
    getWarehouses(),
    getWarehouseCapacity(),
    twinBurnEvents.find({ operatingEpochMs: { $gte: sinceOperatingMs } }).toArray(),
  ]);
  // twinBurnEvents는 자재 단위로만 기록된다(공정·제품 분해 없음). 실적을 자재 합계로 잡고,
  // 같은 자재의 여러 공정 행에는 첫 행에만 실적을 실어 중복 합산을 막는다.
  const actualMap = new Map<string, number>();
  for (const event of consumptionEvents) {
    actualMap.set(event.materialId, (actualMap.get(event.materialId) ?? 0) + event.burnedQty);
  }
  const actualClaimed = new Set<string>();
  const inventoryMap = new Map<string, UsageTwinMaterial["inventory"]>();
  for (const inventory of inventories) {
    if (!inventoryMap.has(inventory.materialId)) {
      inventoryMap.set(inventory.materialId, {
        quantity: inventory.quantity,
        dailyUsage: Math.round(inventory.dailyUsage * 10) / 10,
        doh: inventory.material.ropDays === 0 ? null : inventory.doh,
        unit: inventory.material.unit,
      });
    }
  }

  const materialMap = new Map<string, UsageTwinMaterial>();
  for (const usage of usages) {
    if (!materialMap.has(usage.materialId)) {
      materialMap.set(usage.materialId, {
        id: usage.materialId,
        code: usage.material.code,
        name: usage.material.name,
        unit: usage.material.unit,
        category: usage.material.category,
        processes: [],
        products: [],
        usages: [],
        inventory: inventoryMap.get(usage.materialId) ?? null,
      });
    }
    const material = materialMap.get(usage.materialId)!;
    if (!material.processes.includes(usage.processCode)) material.processes.push(usage.processCode);
    if (!material.products.includes(usage.product)) material.products.push(usage.product);
    material.usages.push({
      proc: usage.processCode,
      product: usage.product,
      qty: usage.monthlyQty,
      actualQty: actualClaimed.has(usage.materialId) ? 0 : (actualClaimed.add(usage.materialId), actualMap.get(usage.materialId) ?? 0),
    });
  }
  for (const inventory of inventories) {
    if (materialMap.has(inventory.materialId)) continue;
    const monthlyQty = Math.round(inventory.dailyUsage * 30);
    materialMap.set(inventory.materialId, {
      id: inventory.materialId,
      code: inventory.material.code,
      name: inventory.material.name,
      unit: inventory.material.unit,
      category: inventory.material.category,
      processes: [],
      products: [],
      usages: monthlyQty > 0 ? [{ proc: "UTIL", product: "ALL", qty: monthlyQty, actualQty: 0 }] : [],
      inventory: inventoryMap.get(inventory.materialId) ?? null,
    });
  }

  const materialWarehouse = new Map<string, string>();
  for (const inventory of inventories) {
    if (!materialWarehouse.has(inventory.materialId)) materialWarehouse.set(inventory.materialId, inventory.warehouse.code);
  }
  type Edge = UsageWarehouseLink & { categoryQuantity: Record<string, number> };
  const edgeMap = new Map<string, Edge>();
  for (const usage of usages) {
    const warehouseCode = materialWarehouse.get(usage.materialId);
    if (!warehouseCode) continue;
    const key = `${warehouseCode}|${usage.processCode}`;
    const edge: Edge = edgeMap.get(key) ?? {
      whCode: warehouseCode,
      procCode: usage.processCode,
      qty: 0,
      category: usage.material.category,
      categoryQuantity: {},
    };
    edge.qty += usage.monthlyQty;
    edge.categoryQuantity[usage.material.category] = (edge.categoryQuantity[usage.material.category] ?? 0) + usage.monthlyQty;
    edgeMap.set(key, edge);
  }
  const links = [...edgeMap.values()].map((edge) => ({
    whCode: edge.whCode,
    procCode: edge.procCode,
    qty: Math.round(edge.qty),
    category: Object.entries(edge.categoryQuantity).sort((a, b) => b[1] - a[1])[0]?.[0] ?? edge.category,
  }));
  const capacityMap = new Map(capacities.map((capacity) => [capacity.code, capacity]));
  const physicalWarehouses = new Set(["MWH-01", "MWH-02", "HZW-01", "MRO-01"]);
  const warehouseOrder = new Map(["MWH-01", "MWH-02", "HZW-01", "MRO-01", "BGY-01", "BCY-01", "PRS-01", "UPW-01"].map((code, index) => [code, index]));
  const warehouseSummary = warehouses.map((warehouse): UsageWarehouse => {
    const warehouseLinks = links.filter((link) => link.whCode === warehouse.code);
    const capacity = capacityMap.get(warehouse.code);
    const totalOccupancy = capacity?.byCategory.reduce((sum, item) => sum + item.occupancy, 0) ?? 0;
    const byCategory = capacity?.byCategory.map((item) => ({
      category: item.category,
      pct: totalOccupancy > 0 ? item.occupancy / totalOccupancy : 0,
    })) ?? [];
    return {
      code: warehouse.code,
      name: warehouse.name,
      type: warehouse.type,
      categories: byCategory.length ? byCategory.map((item) => item.category) : [...new Set(warehouseLinks.map((link) => link.category))],
      processCount: new Set(warehouseLinks.map((link) => link.procCode)).size,
      totalQty: warehouseLinks.reduce((sum, link) => sum + link.qty, 0),
      utilization: capacity?.utilization ?? 0,
      byCategory,
    };
  }).filter((warehouse) => warehouse.totalQty > 0 || physicalWarehouses.has(warehouse.code))
    .sort((a, b) => (warehouseOrder.get(a.code) ?? 99) - (warehouseOrder.get(b.code) ?? 99) || a.code.localeCompare(b.code));

  return {
    materials: [...materialMap.values()].sort((a, b) => a.code.localeCompare(b.code)),
    links,
    warehouses: warehouseSummary,
  };
}
