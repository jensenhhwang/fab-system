import "server-only";

import { materialFactor, WORKING_DAYS } from "@/lib/capacity";
import { collections } from "@/lib/db";
import { buildProcurementSummary } from "@/lib/procurement";
import { getInventoryRows, getProcessUsagesWithMaterial } from "@/lib/queries";
import type { ScenarioMaterial } from "@/lib/scenario-engine";

export async function loadLiveScenarioMaterials(now = new Date()): Promise<{
  materials: ScenarioMaterial[];
  snapshotAt: string;
}> {
  const snapshotAt = now.toISOString();
  const [rows, usages, dbCollections] = await Promise.all([
    getInventoryRows(true),
    getProcessUsagesWithMaterial(),
    collections(),
  ]);
  const [supplierLinks, suppliers, lots, allocations, inboundPlans, agentPolicies] = await Promise.all([
    dbCollections.materialSuppliers.find({}).sort({ isPrimary: -1, leadTimeDays: 1 }).toArray(),
    dbCollections.suppliers.find({}).toArray(),
    dbCollections.inventoryLots.find({ simulated: { $ne: true }, qualityStatus: { $ne: "CONSUMED" } }).toArray(),
    dbCollections.materialAllocations.find({ status: { $in: ["PLANNED", "RESERVED"] } }).toArray(),
    dbCollections.inboundPlans.find({ status: "CONFIRMED", remainingQuantity: { $gt: 0 } }).toArray(),
    dbCollections.agentPolicies.find({}).toArray(),
  ]);

  const linksByMaterial = new Map<string, typeof supplierLinks>();
  for (const link of supplierLinks) {
    linksByMaterial.set(link.materialId, [...(linksByMaterial.get(link.materialId) ?? []), link]);
  }

  const productMap = new Map<string, { HBM: number; DRAM: number; NAND: number }>();
  const usageMetadata = new Map<string, { sources: Set<string>; versions: Set<string> }>();
  for (const usage of usages) {
    const value = productMap.get(usage.materialId) ?? { HBM: 0, DRAM: 0, NAND: 0 };
    value[usage.product] += usage.monthlyQty / WORKING_DAYS;
    productMap.set(usage.materialId, value);
    const metadata = usageMetadata.get(usage.materialId) ?? { sources: new Set<string>(), versions: new Set<string>() };
    metadata.sources.add(usage.source ?? "LEGACY_DERIVED");
    if (usage.sourceVersion) metadata.versions.add(usage.sourceVersion);
    usageMetadata.set(usage.materialId, metadata);
  }

  const reservedByMaterial = new Map<string, number>();
  for (const allocation of allocations) {
    reservedByMaterial.set(allocation.materialId, (reservedByMaterial.get(allocation.materialId) ?? 0) + allocation.quantity);
  }

  const blockedByMaterial = new Map<string, number>();
  const expiringByMaterial = new Map<string, number>();
  const lotLedgerByMaterial = new Map<string, number>();
  const expiryLimit = new Date(now);
  expiryLimit.setUTCDate(expiryLimit.getUTCDate() + 30);
  for (const lot of lots) {
    lotLedgerByMaterial.set(lot.materialId, (lotLedgerByMaterial.get(lot.materialId) ?? 0) + lot.availableQuantity);
    if (lot.qualityStatus === "HOLD" || lot.qualityStatus === "QUARANTINE") {
      blockedByMaterial.set(lot.materialId, (blockedByMaterial.get(lot.materialId) ?? 0) + lot.availableQuantity);
    }
    if (lot.qualityStatus === "AVAILABLE" && lot.expiryDate && lot.expiryDate <= expiryLimit) {
      expiringByMaterial.set(lot.materialId, (expiringByMaterial.get(lot.materialId) ?? 0) + lot.availableQuantity);
    }
  }

  const confirmedInboundByMaterial = new Map<string, { day: number; quantity: number }[]>();
  for (const plan of inboundPlans) {
    const day = Math.max(0, Math.round((plan.plannedDate.getTime() - now.getTime()) / 86_400_000));
    confirmedInboundByMaterial.set(plan.materialId, [
      ...(confirmedInboundByMaterial.get(plan.materialId) ?? []),
      { day, quantity: plan.remainingQuantity },
    ]);
  }

  const policiesByMaterial = new Map<string, NonNullable<ScenarioMaterial["procurementPolicies"]>>();
  for (const policy of agentPolicies) {
    const policies = policiesByMaterial.get(policy.materialId) ?? {};
    policies[policy.fabId] = { moq: policy.moq, orderMultiple: policy.orderMultiple };
    policiesByMaterial.set(policy.materialId, policies);
  }

  const seen = new Set<string>();
  const materials: ScenarioMaterial[] = [];
  for (const row of rows) {
    if (seen.has(row.materialId)) continue;
    seen.add(row.materialId);
    const metadata = usageMetadata.get(row.materialId);
    const procurement = buildProcurementSummary(linksByMaterial.get(row.materialId) ?? [], suppliers);
    materials.push({
      id: row.materialId,
      code: row.material.code,
      name: row.material.name,
      category: row.material.category,
      unit: row.material.unit,
      supplyMode: row.material.supplyMode,
      currentQuantity: row.totalQuantity,
      baseDailyUsage: row.dailyUsage,
      ropDays: row.material.ropDays,
      productDailyUsage: productMap.get(row.materialId) ?? { HBM: 0, DRAM: 0, NAND: 0 },
      warehouseCode: row.warehouse.code,
      warehouseName: row.warehouse.name,
      occupancyFactor: ["HAZMAT", "MRO", "PRECURSOR"].includes(row.warehouse.type) ? 1 : materialFactor(row.material),
      reservedQuantity: reservedByMaterial.get(row.materialId) ?? 0,
      qualityBlockedQuantity: blockedByMaterial.get(row.materialId) ?? 0,
      expiringQuantity30d: expiringByMaterial.get(row.materialId) ?? 0,
      confirmedInboundByDay: confirmedInboundByMaterial.get(row.materialId) ?? [],
      procurementPolicies: policiesByMaterial.get(row.materialId) ?? {},
      inventoryLedgerVariance: lotLedgerByMaterial.has(row.materialId)
        ? row.totalQuantity - (lotLedgerByMaterial.get(row.materialId) ?? 0)
        : null,
      usageSource: metadata ? [...metadata.sources].join(" + ") : row.usageSource,
      usageSourceVersion: metadata ? [...metadata.versions].join(", ") || null : null,
      usageConfidence: row.material.assumptionConfidence ?? (metadata?.sources.has("MES_ACTUAL") ? "HIGH" : "MEDIUM"),
      leadTimeDays: procurement?.normalDays ?? null,
      safeLeadTimeDays: procurement?.safeDays ?? null,
      supplierName: procurement?.supplierName ?? null,
      leadTimeSource: procurement?.normalSource ?? "MISSING",
      procurementAlternatives: procurement?.alternatives.map((alternative) => ({
        supplierName: alternative.supplierName,
        standardDays: alternative.standardDays,
        emergencyOrderAllowed: alternative.emergencyOrderAllowed,
      })) ?? [],
    });
  }

  return { materials, snapshotAt };
}
