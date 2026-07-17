import type { InventoryPolicyStatus, MaterialSupplierDoc } from "@/lib/db";
import { currentLeadTime } from "@/lib/procurement";

export const INVENTORY_SCALE_UP_VERSION = "SAFETY_PLUS_1D_V1" as const;

export type ScaleUpReviewStatus = "READY" | "CAPACITY_REVIEW" | "MASTER_DATA_REVIEW";

export function calculateScaleUpRequirement(input: {
  currentQuantity: number;
  activeInboundQuantity: number;
  safetyStock: number;
  dailyUsage: number;
  policyTargetQuantity?: number | null;
}) {
  const minimumTargetQuantity = Math.ceil(Math.max(0, input.safetyStock + input.dailyUsage));
  const targetQuantity = Math.ceil(Math.max(minimumTargetQuantity, input.policyTargetQuantity ?? 0));
  const inventoryPosition = input.currentQuantity + input.activeInboundQuantity;
  const replenishmentQuantity = Math.max(0, targetQuantity - inventoryPosition);
  const projectedQuantity = inventoryPosition + replenishmentQuantity;
  return {
    minimumTargetQuantity,
    targetQuantity,
    inventoryPosition,
    replenishmentQuantity,
    projectedQuantity,
    projectedDoh: input.dailyUsage > 0 ? projectedQuantity / input.dailyUsage : null,
  };
}

export function selectScaleUpSupplier(links: MaterialSupplierDoc[], now = new Date()) {
  return [...links].sort((a, b) => {
    const approvedA = a.qualificationStatus === "APPROVED" ? 0 : 1;
    const approvedB = b.qualificationStatus === "APPROVED" ? 0 : 1;
    const primaryA = (a.sourcingRole === "PRIMARY" || a.isPrimary) ? 0 : 1;
    const primaryB = (b.sourcingRole === "PRIMARY" || b.isPrimary) ? 0 : 1;
    return approvedA - approvedB || primaryA - primaryB
      || (currentLeadTime(a, now).days ?? 9999) - (currentLeadTime(b, now).days ?? 9999);
  })[0] ?? null;
}

export function scaleUpReviewStatus(input: {
  supplierApproved: boolean;
  policyStatus?: InventoryPolicyStatus | null;
}): ScaleUpReviewStatus {
  if (input.policyStatus === "BLOCKED_CAPACITY") return "CAPACITY_REVIEW";
  if (!input.supplierApproved || input.policyStatus === "BLOCKED_MASTER_DATA") return "MASTER_DATA_REVIEW";
  return "READY";
}
