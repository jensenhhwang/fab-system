export const dynamic = "force-dynamic";

import { getProcessUsagesWithMaterial, getInventoryRows, getWarehouses } from "@/lib/queries";
import UsageClient from "./UsageClient";

async function getUsageData() {
  const [usages, invRows] = await Promise.all([
    getProcessUsagesWithMaterial(),
    getInventoryRows(),
  ]);

  // 재고 맵: materialId → { quantity, dailyUsage, doh, unit }
  const invMap = new Map<string, { quantity: number; dailyUsage: number; doh: number | null; unit: string }>();
  for (const inv of invRows) {
    if (!invMap.has(inv.materialId))
      invMap.set(inv.materialId, {
        quantity: inv.quantity,
        dailyUsage: Math.round(inv.dailyUsage * 10) / 10,
        doh: inv.material.ropDays === 0 ? null : inv.doh,
        unit: inv.material.unit,
      });
  }

  const materialMap = new Map<string, {
    id: string; code: string; name: string; category: string;
    processes: string[]; products: string[];
    usages: { proc: string; product: string; qty: number }[];
    inventory: { quantity: number; dailyUsage: number; doh: number | null; unit: string } | null;
  }>();

  for (const u of usages) {
    const key = u.materialId;
    if (!materialMap.has(key)) {
      materialMap.set(key, {
        id: u.materialId,
        code: u.material.code,
        name: u.material.name,
        category: u.material.category,
        processes: [],
        products: [],
        usages: [],
        inventory: invMap.get(u.materialId) ?? null,
      });
    }
    const entry = materialMap.get(key)!;
    if (!entry.processes.includes(u.processCode)) entry.processes.push(u.processCode);
    if (!entry.products.includes(u.product)) entry.products.push(u.product);
    entry.usages.push({ proc: u.processCode, product: u.product, qty: u.monthlyQty });
  }

  // ProcessUsage 없는 자재(시설 인프라 등)도 재고 데이터로 포함
  for (const inv of invRows) {
    if (!materialMap.has(inv.materialId)) {
      const monthlyQty = Math.round(inv.dailyUsage * 30);
      materialMap.set(inv.materialId, {
        id: inv.materialId,
        code: inv.material.code,
        name: inv.material.name,
        category: inv.material.category,
        processes: [],
        products: [],
        usages: monthlyQty > 0 ? [{ proc: "UTIL", product: "ALL", qty: monthlyQty }] : [],
        inventory: invMap.get(inv.materialId) ?? null,
      });
    }
  }

  return Array.from(materialMap.values()).sort((a, b) => a.code.localeCompare(b.code));
}

// 공정 ↔ 자재창고 연결 그래프 도출
//   ProcessUsage(공정→자재) ⋈ Inventory(자재→창고) → (창고,공정) 엣지
async function getWarehouseGraph() {
  const [usages, inventories, warehouses] = await Promise.all([
    getProcessUsagesWithMaterial(),
    getInventoryRows(),
    getWarehouses(),
  ]);

  // materialId → 창고코드 (seed 상 자재는 대체로 단일 창고에 보관, 첫 매칭 사용)
  const matToWh = new Map<string, string>();
  for (const inv of inventories) {
    if (!matToWh.has(inv.materialId)) matToWh.set(inv.materialId, inv.warehouse.code);
  }

  // (창고,공정) 엣지 집계: 총 월사용량 + 카테고리별 사용량
  type Edge = { whCode: string; procCode: string; qty: number; catQty: Record<string, number> };
  const edgeMap = new Map<string, Edge>();
  for (const u of usages) {
    const whCode = matToWh.get(u.materialId);
    if (!whCode) continue;
    const key = `${whCode}|${u.processCode}`;
    if (!edgeMap.has(key)) edgeMap.set(key, { whCode, procCode: u.processCode, qty: 0, catQty: {} });
    const e = edgeMap.get(key)!;
    e.qty += u.monthlyQty;
    const cat = u.material.category;
    e.catQty[cat] = (e.catQty[cat] ?? 0) + u.monthlyQty;
  }

  const links = Array.from(edgeMap.values()).map((e) => {
    // 엣지 대표 카테고리 = 사용량 최대 카테고리
    const category = Object.entries(e.catQty).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "GAS";
    return { whCode: e.whCode, procCode: e.procCode, qty: Math.round(e.qty), category };
  });

  // 창고 요약: 총 공급량 + 취급 카테고리 + 연결 공정 수
  const whSummary = warehouses.map((w) => {
    const wlinks = links.filter((l) => l.whCode === w.code);
    const catQty: Record<string, number> = {};
    for (const l of wlinks) catQty[l.category] = (catQty[l.category] ?? 0) + l.qty;
    const categories = Object.entries(catQty).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    return {
      code: w.code,
      name: w.name,
      type: w.type,
      categories,
      processCount: new Set(wlinks.map((l) => l.procCode)).size,
      totalQty: wlinks.reduce((s, l) => s + l.qty, 0),
    };
  }).filter((w) => w.totalQty > 0); // 공정과 연결된 창고만

  return { links, warehouses: whSummary };
}

export default async function UsagePage() {
  const [materials, graph] = await Promise.all([getUsageData(), getWarehouseGraph()]);
  return <UsageClient materials={materials} warehouseLinks={graph.links} warehouses={graph.warehouses} />;
}
