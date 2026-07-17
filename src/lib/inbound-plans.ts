import type { InboundPlanDoc, InboundPlanStatus } from "@/lib/db";

export type InboundPlanInput = {
  materialId: string;
  supplierId: string;
  plannedDate: Date;
  plannedQuantity: number;
  note: string | null;
};

export function parseInboundPlanInput(body: Record<string, unknown>):
  | { value: InboundPlanInput; error?: never }
  | { value?: never; error: string } {
  const materialId = String(body.materialId ?? "").trim();
  const supplierId = String(body.supplierId ?? "").trim();
  const plannedQuantity = Number(body.plannedQuantity);
  const rawDate = String(body.plannedDate ?? "").trim();
  const plannedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? new Date(`${rawDate}T00:00:00.000Z`)
    : new Date(Number.NaN);

  if (!materialId || !supplierId) return { error: "자재와 공급사는 필수입니다." };
  if (!Number.isFinite(plannedQuantity) || plannedQuantity <= 0) return { error: "계획수량은 0보다 커야 합니다." };
  if (Number.isNaN(plannedDate.getTime()) || plannedDate.toISOString().slice(0, 10) !== rawDate) return { error: "유효한 예정일을 입력해주세요." };

  return {
    value: {
      materialId,
      supplierId,
      plannedDate,
      plannedQuantity,
      note: String(body.note ?? "").trim() || null,
    },
  };
}

export function canTransitionInboundPlan(from: InboundPlanStatus, to: InboundPlanStatus) {
  return (from === "DRAFT" && (to === "CONFIRMED" || to === "CANCELLED"))
    || (from === "CONFIRMED" && (to === "COMPLETED" || to === "CANCELLED"));
}

export function inboundPlanProgress(plan: Pick<InboundPlanDoc, "plannedQuantity" | "receivedQuantity">) {
  const remainingQuantity = Math.max(0, plan.plannedQuantity - plan.receivedQuantity);
  return {
    remainingQuantity,
    completionPct: plan.plannedQuantity === 0 ? 0 : Math.min(100, plan.receivedQuantity / plan.plannedQuantity * 100),
  };
}
