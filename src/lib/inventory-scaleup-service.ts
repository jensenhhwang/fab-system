import { createHash, randomUUID } from "crypto";
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

export type InventoryScaleUpDraftPreview = {
  proposal: InventoryScaleUpProposal & {
    supplierId: string;
    supplierName: string;
    plannedDate: Date;
    reviewStatus: "READY";
  };
  previewHash: string;
  formulaVersion: typeof INVENTORY_SCALE_UP_VERSION;
};

export class InventoryScaleUpDraftError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "InventoryScaleUpDraftError";
  }
}

function scaleUpPreviewHash(input: {
  proposal: InventoryScaleUpDraftPreview["proposal"];
  formulaVersion: typeof INVENTORY_SCALE_UP_VERSION;
}) {
  const item = input.proposal;
  return createHash("sha256").update(JSON.stringify({
    formulaVersion: input.formulaVersion,
    materialId: item.materialId,
    supplierId: item.supplierId,
    plannedDate: item.plannedDate.toISOString(),
    currentQuantity: item.currentQuantity,
    activeInboundQuantity: item.activeInboundQuantity,
    safetyStock: item.safetyStock,
    dailyUsage: item.dailyUsage,
    targetQuantity: item.targetQuantity,
    replenishmentQuantity: item.replenishmentQuantity,
    reviewStatus: item.reviewStatus,
  })).digest("hex");
}

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

export async function previewInventoryScaleUpDraftForMaterial(
  materialId: string,
  now = new Date(),
): Promise<InventoryScaleUpDraftPreview> {
  const overview = await getInventoryScaleUpOverview(now);
  const candidate = overview.proposals.find((item) => item.materialId === materialId);
  if (!candidate) {
    throw new InventoryScaleUpDraftError(
      "SCALE_UP_NOT_REQUIRED",
      "최신 재고 기준으로는 이 자재의 추가 입고계획이 필요하지 않습니다.",
    );
  }
  if (
    candidate.reviewStatus !== "READY"
    || !candidate.supplierId
    || !candidate.supplierName
    || !candidate.plannedDate
  ) {
    throw new InventoryScaleUpDraftError(
      "SCALE_UP_REVIEW_REQUIRED",
      candidate.blockReason ?? "공급사 또는 보관 Capacity 검토가 먼저 필요합니다.",
    );
  }
  const proposal: InventoryScaleUpDraftPreview["proposal"] = {
    ...candidate,
    supplierId: candidate.supplierId,
    supplierName: candidate.supplierName,
    plannedDate: candidate.plannedDate,
    reviewStatus: "READY",
  };
  return {
    proposal,
    formulaVersion: overview.formulaVersion,
    previewHash: scaleUpPreviewHash({ proposal, formulaVersion: overview.formulaVersion }),
  };
}

export async function createInventoryScaleUpDraftForMaterial(input: {
  materialId: string;
  userId: string;
  actionId: string;
  expectedPreviewHash: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const { inboundPlans } = await collections();
  const id = `CT-INBOUND:${input.actionId}`;
  const existing = await inboundPlans.findOne({ _id: id });
  if (existing) return { plan: existing, duplicate: true };

  const preview = await previewInventoryScaleUpDraftForMaterial(input.materialId, now);
  if (preview.previewHash !== input.expectedPreviewHash) {
    throw new InventoryScaleUpDraftError(
      "SCALE_UP_PREVIEW_STALE",
      "재고 또는 진행 중 입고가 변경되었습니다. 최신 미리보기를 다시 확인해 주세요.",
    );
  }
  const item = preview.proposal;
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const doc: InboundPlanDoc = {
    _id: id,
    planNo: `CT-${datePart}-${input.actionId.slice(0, 6).toUpperCase()}`,
    materialId: item.materialId,
    supplierId: item.supplierId,
    unit: item.unit,
    plannedDate: item.plannedDate,
    plannedQuantity: item.replenishmentQuantity,
    receivedQuantity: 0,
    remainingQuantity: item.replenishmentQuantity,
    status: "DRAFT",
    note: `관제탑 Q&A 실행 · 재고 스케일업 · 목표 ${item.targetQuantity.toLocaleString()} ${item.unit}`,
    source: "INVENTORY_SCALE_UP",
    scaleUpRequestId: input.actionId,
    scaleUp: {
      formulaVersion: preview.formulaVersion,
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
  try {
    await inboundPlans.insertOne(doc);
    return { plan: doc, duplicate: false };
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && (error as { code?: number }).code === 11000
    ) {
      const duplicate = await inboundPlans.findOne({ _id: id });
      if (duplicate) return { plan: duplicate, duplicate: true };
    }
    throw error;
  }
}
