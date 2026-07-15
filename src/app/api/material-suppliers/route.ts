import { NextRequest, NextResponse } from "next/server";
import { collections, type MaterialSupplierDoc } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { materialSuppliers, materials, suppliers } = await collections();
  const [links, materialDocs, supplierDocs] = await Promise.all([
    materialSuppliers.find({}).sort({ materialId: 1, isPrimary: -1 }).toArray(), materials.find({}).sort({ code: 1 }).toArray(), suppliers.find({}).sort({ name: 1 }).toArray(),
  ]);
  return NextResponse.json({ links, materials: materialDocs, suppliers: supplierDocs });
}

function optionalNumber(value: unknown) { return value === "" || value == null ? null : Number(value); }
function validateLeadTimes(body: Record<string, unknown>) {
  const min = optionalNumber(body.minLeadTimeDays); const standard = optionalNumber(body.standardLeadTimeDays); const max = optionalNumber(body.maxLeadTimeDays);
  const share = optionalNumber(body.plannedSharePct);
  for (const value of [min, standard, max, optionalNumber(body.currentExpectedLeadTimeDays)]) if (value !== null && (!Number.isInteger(value) || value < 0)) return "리드타임은 0 이상의 정수여야 합니다.";
  if (share !== null && (!Number.isFinite(share) || share < 0 || share > 100)) return "계획 배분율은 0~100% 범위여야 합니다.";
  if (min !== null && standard !== null && min > standard) return "최소 리드타임은 기준보다 클 수 없습니다.";
  if (standard !== null && max !== null && standard > max) return "기준 리드타임은 최대보다 클 수 없습니다.";
  if (body.currentExpectedLeadTimeDays != null && Number(body.currentExpectedLeadTimeDays) !== standard && !String(body.leadTimeReason ?? "").trim()) return "현재 예상 리드타임이 기준과 다르면 사유가 필요합니다.";
  return null;
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.procurementMaster); if (access.error) return access.error;
  const body = await req.json() as Record<string, unknown>; const error = validateLeadTimes(body);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const materialId = String(body.materialId ?? ""); const supplierId = String(body.supplierId ?? "");
  if (!materialId || !supplierId) return NextResponse.json({ error: "자재와 공급사는 필수입니다." }, { status: 400 });
  const { materialSuppliers, materials, suppliers } = await collections();
  const [material, supplier, duplicate] = await Promise.all([materials.findOne({ _id: materialId }), suppliers.findOne({ _id: supplierId }), materialSuppliers.findOne({ materialId, supplierId })]);
  if (!material || !supplier) return NextResponse.json({ error: "자재 또는 공급사를 찾을 수 없습니다." }, { status: 404 });
  if (duplicate) return NextResponse.json({ error: "이미 연결된 자재·공급사입니다." }, { status: 409 });
  const sourcingRole = body.sourcingRole === "PRIMARY" ? "PRIMARY" : "SECONDARY";
  if (sourcingRole === "PRIMARY" && await materialSuppliers.findOne({ materialId, sourcingRole: "PRIMARY" })) return NextResponse.json({ error: "주공급사는 자재별 한 곳만 지정할 수 있습니다." }, { status: 409 });
  const standard = optionalNumber(body.standardLeadTimeDays);
  if (standard === null) return NextResponse.json({ error: "기준 리드타임은 필수입니다." }, { status: 400 });
  const doc: MaterialSupplierDoc = {
    _id: crypto.randomUUID(), materialId, supplierId, leadTimeDays: standard, isPrimary: sourcingRole === "PRIMARY",
    qualificationStatus: ["APPROVED","CONDITIONAL","SUSPENDED"].includes(String(body.qualificationStatus)) ? body.qualificationStatus as MaterialSupplierDoc["qualificationStatus"] : "CONDITIONAL",
    sourcingRole, minLeadTimeDays: optionalNumber(body.minLeadTimeDays), standardLeadTimeDays: standard, maxLeadTimeDays: optionalNumber(body.maxLeadTimeDays),
    currentExpectedLeadTimeDays: optionalNumber(body.currentExpectedLeadTimeDays), currentExpectedValidUntil: body.currentExpectedValidUntil ? new Date(String(body.currentExpectedValidUntil)) : null,
    leadTimeReason: String(body.leadTimeReason ?? "").trim() || null, emergencyOrderAllowed: Boolean(body.emergencyOrderAllowed),
    plannedSharePct: optionalNumber(body.plannedSharePct), updatedAt: new Date(),
  };
  await materialSuppliers.insertOne(doc); return NextResponse.json(doc, { status: 201 });
}
