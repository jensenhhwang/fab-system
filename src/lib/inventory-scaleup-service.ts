import { randomUUID } from "crypto";
import { collections, type InboundPlanDoc, type MaterialSupplierDoc } from "@/lib/db";
import { getInventoryRows } from "@/lib/queries";
import { currentLeadTime } from "@/lib/procurement";
import {
  calculateScaleUpRequirement,
  INVENTORY_SCALE_UP_VERSION,
  scaleUpReviewStatus,
  selectScaleUpSupplier,
  type ScaleUpReviewStatus,
} from "@/lib/inventory-scaleup";

export type InventoryScaleUpProposal = {
  materialId: string; code: string; name: string; unit: string;
  currentQuantity: number; safetyStock: number; dailyUsage: number;
  activeInboundQuantity: number; inventoryPosition: number;
  minimumTargetQuantity: number; targetQuantity: number; replenishmentQuantity: number;
  projectedQuantity: number; projectedDoh: number | null;
  supplierId: string | null; supplierName: string | null; plannedDate: Date | null;
  reviewStatus: ScaleUpReviewStatus; blockReason: string | null; canCreate: boolean;
};

export type InventoryScaleUpOverview = {
  formulaVersion: typeof INVENTORY_SCALE_UP_VERSION;
  proposals: InventoryScaleUpProposal[];
  counts: { total: number; ready: number; capacityReview: number; masterReview: number; creatable: number };
};

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Math.max(1, Math.ceil(days)));
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

export async function getInventoryScaleUpOverview(now = new Date()): Promise<InventoryScaleUpOverview> {
  const { inboundPlans, inventoryPolicies, materialSuppliers, suppliers } = await collections();
  const [rows, activePlans, policies, links, supplierDocs] = await Promise.all([
    getInventoryRows(true),
    inboundPlans.find({ status: { $in: ["DRAFT", "CONFIRMED"] }, remainingQuantity: { $gt: 0 } }).toArray(),
    inventoryPolicies.find({}).toArray(),
    materialSuppliers.find({}).toArray(),
    suppliers.find({}).toArray(),
  ]);
  const activeInbound = new Map<string, number>();
  for (const plan of activePlans) activeInbound.set(plan.materialId, (activeInbound.get(plan.materialId) ?? 0) + plan.remainingQuantity);
  const policyMap = new Map(policies.map(policy => [policy.materialId, policy]));
  const supplierMap = new Map(supplierDocs.map(supplier => [supplier._id, supplier.name]));
  const linksByMaterial = new Map<string, MaterialSupplierDoc[]>();
  for (const link of links) linksByMaterial.set(link.materialId, [...(linksByMaterial.get(link.materialId) ?? []), link]);
  const uniqueRows = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!uniqueRows.has(row.materialId)) uniqueRows.set(row.materialId, row);

  const proposals: InventoryScaleUpProposal[] = [];
  for (const row of uniqueRows.values()) {
    if (row.material.ropDays <= 0 || row.dailyUsage <= 0) continue;
    const policy = policyMap.get(row.materialId);
    const calculation = calculateScaleUpRequirement({
      currentQuantity: row.totalQuantity,
      activeInboundQuantity: activeInbound.get(row.materialId) ?? 0,
      safetyStock: row.material.safetyStock,
      dailyUsage: row.dailyUsage,
      policyTargetQuantity: policy?.targetQuantity,
    });
    if (calculation.replenishmentQuantity <= 0) continue;
    const supplierLink = selectScaleUpSupplier(linksByMaterial.get(row.materialId) ?? [], now);
    const approved = supplierLink?.qualificationStatus === "APPROVED";
    const reviewStatus = scaleUpReviewStatus({ supplierApproved: approved, policyStatus: policy?.status });
    const leadTimeDays = supplierLink ? (currentLeadTime(supplierLink, now).days ?? supplierLink.leadTimeDays ?? 0) : 0;
    const blockReason = !supplierLink
      ? "자재·공급사 연결이 없습니다."
      : reviewStatus === "CAPACITY_REVIEW"
        ? policy?.blockReason ?? "분할입고와 보관 Capacity 검토가 필요합니다."
        : reviewStatus === "MASTER_DATA_REVIEW"
          ? policy?.blockReason ?? "공급사 승인 또는 조달 마스터 보완이 필요합니다."
          : null;
    proposals.push({
      materialId: row.materialId, code: row.material.code, name: row.material.name, unit: row.material.unit,
      currentQuantity: row.totalQuantity, safetyStock: row.material.safetyStock, dailyUsage: row.dailyUsage,
      activeInboundQuantity: activeInbound.get(row.materialId) ?? 0,
      inventoryPosition: calculation.inventoryPosition,
      minimumTargetQuantity: calculation.minimumTargetQuantity,
      targetQuantity: calculation.targetQuantity,
      replenishmentQuantity: calculation.replenishmentQuantity,
      projectedQuantity: calculation.projectedQuantity,
      projectedDoh: calculation.projectedDoh,
      supplierId: supplierLink?.supplierId ?? null,
      supplierName: supplierLink ? supplierMap.get(supplierLink.supplierId) ?? supplierLink.supplierId : null,
      plannedDate: addDays(now, leadTimeDays),
      reviewStatus, blockReason, canCreate: true,
    });
  }
  proposals.sort((a, b) => (a.currentQuantity / a.dailyUsage) - (b.currentQuantity / b.dailyUsage));
  return {
    formulaVersion: INVENTORY_SCALE_UP_VERSION,
    proposals,
    counts: {
      total: proposals.length,
      ready: proposals.filter(item => item.reviewStatus === "READY").length,
      capacityReview: proposals.filter(item => item.reviewStatus === "CAPACITY_REVIEW").length,
      masterReview: proposals.filter(item => item.reviewStatus === "MASTER_DATA_REVIEW").length,
      creatable: proposals.filter(item => item.canCreate).length,
    },
  };
}

export async function createInventoryScaleUpDrafts(input: { userId: string; requestId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const { inboundPlans } = await collections();
  const existing = await inboundPlans.find({ scaleUpRequestId: input.requestId }).toArray();
  if (existing.length) return { overview: await getInventoryScaleUpOverview(now), created: existing.length, duplicate: true };
  const overview = await getInventoryScaleUpOverview(now);
  const docs: InboundPlanDoc[] = overview.proposals.filter(item => item.canCreate && item.plannedDate).map(item => {
    const id = randomUUID();
    const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
    return {
      _id: id,
      planNo: `SU-${datePart}-${id.slice(0, 6).toUpperCase()}`,
      materialId: item.materialId,
      supplierId: item.supplierId ?? "",
      unit: item.unit,
      plannedDate: item.plannedDate!,
      plannedQuantity: item.replenishmentQuantity,
      receivedQuantity: 0,
      remainingQuantity: item.replenishmentQuantity,
      status: "DRAFT",
      note: `재고 스케일업 · 목표 ${item.targetQuantity.toLocaleString()} ${item.unit}${item.blockReason ? ` · ${item.blockReason}` : ""}`,
      source: "INVENTORY_SCALE_UP",
      scaleUpRequestId: input.requestId,
      scaleUp: {
        formulaVersion: INVENTORY_SCALE_UP_VERSION,
        reviewStatus: item.reviewStatus,
        referenceQuantity: item.currentQuantity,
        activeInboundQuantity: item.activeInboundQuantity,
        safetyStock: item.safetyStock,
        dailyUsage: item.dailyUsage,
        targetQuantity: item.targetQuantity,
      },
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
      events: [{ type: "CREATED", userId: input.userId, at: now }],
    };
  });
  if (docs.length) await inboundPlans.insertMany(docs);
  return { overview: await getInventoryScaleUpOverview(now), created: docs.length, duplicate: false };
}
