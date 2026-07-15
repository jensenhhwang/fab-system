import { NextRequest, NextResponse } from "next/server";
import { collections, type MaterialSupplierDoc } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export const dynamic = "force-dynamic";
function numberOrNull(value: unknown) { return value === "" || value == null ? null : Number(value); }

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(WRITE_ROLES.procurementMaster); if (access.error) return access.error;
  const { id } = await params; const body = await req.json() as Record<string, unknown>; const { materialSuppliers } = await collections();
  const existing = await materialSuppliers.findOne({ _id: id }); if (!existing) return NextResponse.json({ error: "조달 기준을 찾을 수 없습니다." }, { status: 404 });
  const min = numberOrNull(body.minLeadTimeDays); const standard = numberOrNull(body.standardLeadTimeDays); const max = numberOrNull(body.maxLeadTimeDays); const current = numberOrNull(body.currentExpectedLeadTimeDays);
  const share = numberOrNull(body.plannedSharePct);
  for (const value of [min, standard, max, current]) if (value !== null && (!Number.isInteger(value) || value < 0)) return NextResponse.json({ error: "리드타임은 0 이상의 정수여야 합니다." }, { status: 400 });
  if (share !== null && (!Number.isFinite(share) || share < 0 || share > 100)) return NextResponse.json({ error: "계획 배분율은 0~100% 범위여야 합니다." }, { status: 400 });
  if (standard === null) return NextResponse.json({ error: "기준 리드타임은 필수입니다." }, { status: 400 });
  if ((min !== null && min > standard) || (max !== null && standard > max)) return NextResponse.json({ error: "최소 ≤ 기준 ≤ 최대 순서여야 합니다." }, { status: 400 });
  if (current !== null && current !== standard && !String(body.leadTimeReason ?? "").trim()) return NextResponse.json({ error: "현재 예상값이 기준과 다르면 사유가 필요합니다." }, { status: 400 });
  const role = body.sourcingRole === "PRIMARY" ? "PRIMARY" : "SECONDARY";
  if (role === "PRIMARY" && await materialSuppliers.findOne({ materialId: existing.materialId, sourcingRole: "PRIMARY", _id: { $ne: id } })) return NextResponse.json({ error: "주공급사는 자재별 한 곳만 지정할 수 있습니다." }, { status: 409 });
  const set: Partial<MaterialSupplierDoc> = {
    leadTimeDays: standard, standardLeadTimeDays: standard, minLeadTimeDays: min, maxLeadTimeDays: max,
    qualificationStatus: ["APPROVED","CONDITIONAL","SUSPENDED"].includes(String(body.qualificationStatus)) ? body.qualificationStatus as MaterialSupplierDoc["qualificationStatus"] : "CONDITIONAL",
    sourcingRole: role, isPrimary: role === "PRIMARY", currentExpectedLeadTimeDays: current,
    currentExpectedValidUntil: body.currentExpectedValidUntil ? new Date(String(body.currentExpectedValidUntil)) : null,
    leadTimeReason: String(body.leadTimeReason ?? "").trim() || null, emergencyOrderAllowed: Boolean(body.emergencyOrderAllowed),
    plannedSharePct: share, updatedAt: new Date(),
  };
  await materialSuppliers.updateOne({ _id: id }, { $set: set }); return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(WRITE_ROLES.procurementMaster); if (access.error) return access.error;
  const { id } = await params; const { materialSuppliers } = await collections(); const result = await materialSuppliers.deleteOne({ _id: id });
  if (!result.deletedCount) return NextResponse.json({ error: "조달 기준을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
