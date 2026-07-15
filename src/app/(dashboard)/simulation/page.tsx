export const dynamic = "force-dynamic";

import { getInventoryRows, getProcessUsagesWithMaterial } from "@/lib/queries";
import ProductionIncreasePlanner from "./ProductionIncreasePlanner";
import type { ScenarioMaterial } from "@/lib/scenario-engine";
import { materialFactor } from "@/lib/capacity";
import { collections } from "@/lib/db";
import { buildProcurementSummary } from "@/lib/procurement";

export default async function ScenarioPage() {
  const [rows, usages, dbCollections] = await Promise.all([getInventoryRows(true), getProcessUsagesWithMaterial(), collections()]);
  const [supplierLinks, suppliers] = await Promise.all([
    dbCollections.materialSuppliers.find({}).sort({ isPrimary: -1, leadTimeDays: 1 }).toArray(),
    dbCollections.suppliers.find({}).toArray(),
  ]);
  const linksByMaterial = new Map<string, typeof supplierLinks>();
  for (const link of supplierLinks) linksByMaterial.set(link.materialId, [...(linksByMaterial.get(link.materialId) ?? []), link]);
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
      ...(() => { const summary = buildProcurementSummary(linksByMaterial.get(row.materialId) ?? [], suppliers); return {
        leadTimeDays: summary?.normalDays ?? null, safeLeadTimeDays: summary?.safeDays ?? null,
        supplierName: summary?.supplierName ?? null, leadTimeSource: summary?.normalSource ?? "MISSING" as const,
        procurementAlternatives: summary?.alternatives.map(alternative => ({ supplierName: alternative.supplierName, standardDays: alternative.standardDays, emergencyOrderAllowed: alternative.emergencyOrderAllowed })) ?? [],
      }; })(),
    });
  }
  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="text-2xl font-bold" style={{ color: "var(--text-1)" }}>운영 What-if 시나리오</div>
          <div className="mt-1 text-xs" style={{ color: "var(--text-3)" }}>현재 재고 스냅샷에 명시한 수요·입고 조건만 적용하는 재현 가능한 분석입니다.</div>
        </div>
        <span className="rounded-full bg-[#E8F3FF] px-3 py-1 text-[11px] font-bold text-[#0078D4]">SIMULATION</span>
      </div>
      <ProductionIncreasePlanner materials={materials} snapshotAt={new Date().toISOString()} />
    </>
  );
}
