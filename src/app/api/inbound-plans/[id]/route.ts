import { NextRequest, NextResponse } from "next/server";
import { collections, type InboundPlanEvent } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { canTransitionInboundPlan, parseInboundPlanInput } from "@/lib/inbound-plans";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  const access = await requireRole(WRITE_ROLES.inboundPlan);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json() as Record<string, unknown>;
  const action = String(body.action ?? "UPDATE");
  const { inboundPlans, materials, suppliers, materialSuppliers } = await collections();
  const existing = await inboundPlans.findOne({ _id: id });
  if (!existing) return NextResponse.json({ error: "입고계획을 찾을 수 없습니다." }, { status: 404 });
  const now = new Date();

  if (action === "UPDATE") {
    if (existing.status !== "DRAFT") return NextResponse.json({ error: "초안 상태에서만 계획을 수정할 수 있습니다." }, { status: 409 });
    const parsed = parseInboundPlanInput(body);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const value = parsed.value;
    const [material, supplier, link] = await Promise.all([
      materials.findOne({ _id: value.materialId }),
      suppliers.findOne({ _id: value.supplierId }),
      materialSuppliers.findOne({ materialId: value.materialId, supplierId: value.supplierId }),
    ]);
    if (!material || !supplier) return NextResponse.json({ error: "자재 또는 공급사를 찾을 수 없습니다." }, { status: 404 });
    if (!link) return NextResponse.json({ error: "등록된 자재·공급사 조합만 계획에 사용할 수 있습니다." }, { status: 400 });
    const changes: NonNullable<InboundPlanEvent["changes"]> = {};
    for (const [key, before, after] of [
      ["materialId", existing.materialId, value.materialId],
      ["supplierId", existing.supplierId, value.supplierId],
      ["plannedDate", existing.plannedDate.toISOString().slice(0, 10), value.plannedDate.toISOString().slice(0, 10)],
      ["plannedQuantity", existing.plannedQuantity, value.plannedQuantity],
      ["note", existing.note ?? null, value.note],
    ] as const) if (before !== after) changes[key] = { before, after };
    const result = await inboundPlans.updateOne(
      { _id: id, status: "DRAFT" },
      { $set: { ...value, unit: material.unit, remainingQuantity: value.plannedQuantity, updatedAt: now },
        $push: { events: { type: "UPDATED", userId: access.user.id, at: now, changes } } },
    );
    if (!result.modifiedCount) return NextResponse.json({ error: "다른 작업자가 계획을 변경했습니다. 새로고침 후 다시 시도해주세요." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (action === "CONFIRM") {
    if (!canTransitionInboundPlan(existing.status, "CONFIRMED")) return NextResponse.json({ error: "초안 계획만 확정할 수 있습니다." }, { status: 409 });
    const approved = await materialSuppliers.findOne({ materialId: existing.materialId, supplierId: existing.supplierId, qualificationStatus: "APPROVED" });
    if (!approved) return NextResponse.json({ error: "승인된 자재·공급사 조합만 확정할 수 있습니다." }, { status: 400 });
    const result = await inboundPlans.updateOne(
      { _id: id, status: "DRAFT" },
      { $set: { status: "CONFIRMED", confirmedBy: access.user.id, confirmedAt: now, updatedAt: now },
        $push: { events: { type: "CONFIRMED", userId: access.user.id, at: now } } },
    );
    if (!result.modifiedCount) return NextResponse.json({ error: "계획 상태가 이미 변경되었습니다." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  if (action === "CANCEL") {
    if (!canTransitionInboundPlan(existing.status, "CANCELLED")) return NextResponse.json({ error: "초안 또는 확정 계획만 취소할 수 있습니다." }, { status: 409 });
    const reason = String(body.reason ?? "").trim();
    if (!reason) return NextResponse.json({ error: "취소 사유를 입력해주세요." }, { status: 400 });
    const result = await inboundPlans.updateOne(
      { _id: id, status: existing.status },
      { $set: { status: "CANCELLED", cancelledBy: access.user.id, cancelledAt: now, cancelReason: reason, updatedAt: now },
        $push: { events: { type: "CANCELLED", userId: access.user.id, at: now, reason } } },
    );
    if (!result.modifiedCount) return NextResponse.json({ error: "계획 상태가 이미 변경되었습니다." }, { status: 409 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
}
