import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { collections, type InboundPlanDoc, type InboundPlanStatus } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { parseInboundPlanInput } from "@/lib/inbound-plans";

export const dynamic = "force-dynamic";

const STATUSES: InboundPlanStatus[] = ["DRAFT", "CONFIRMED", "COMPLETED", "CANCELLED"];

export async function GET(req: NextRequest) {
  const requestedStatus = req.nextUrl.searchParams.get("status") as InboundPlanStatus | null;
  if (requestedStatus && !STATUSES.includes(requestedStatus)) {
    return NextResponse.json({ error: "지원하지 않는 계획 상태입니다." }, { status: 400 });
  }
  const { inboundPlans, materials, suppliers } = await collections();
  const [plans, materialDocs, supplierDocs] = await Promise.all([
    inboundPlans.find(requestedStatus ? { status: requestedStatus, remainingQuantity: { $gt: 0 } } : {})
      .sort({ plannedDate: 1, createdAt: -1 }).toArray(),
    materials.find({}).sort({ code: 1 }).toArray(),
    suppliers.find({}).sort({ name: 1 }).toArray(),
  ]);
  return NextResponse.json({ plans, materials: materialDocs, suppliers: supplierDocs });
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.inboundPlan);
  if (access.error) return access.error;
  const body = await req.json() as Record<string, unknown>;
  const parsed = parseInboundPlanInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const value = parsed.value;

  const { materials, suppliers, materialSuppliers, inboundPlans } = await collections();
  const [material, supplier, link] = await Promise.all([
    materials.findOne({ _id: value.materialId }),
    suppliers.findOne({ _id: value.supplierId }),
    materialSuppliers.findOne({ materialId: value.materialId, supplierId: value.supplierId }),
  ]);
  if (!material || !supplier) return NextResponse.json({ error: "자재 또는 공급사를 찾을 수 없습니다." }, { status: 404 });
  if (!link) return NextResponse.json({ error: "등록된 자재·공급사 조합만 계획에 사용할 수 있습니다." }, { status: 400 });

  const now = new Date();
  const id = randomUUID();
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const doc: InboundPlanDoc = {
    _id: id,
    planNo: `IP-${datePart}-${id.slice(0, 6).toUpperCase()}`,
    ...value,
    unit: material.unit,
    receivedQuantity: 0,
    remainingQuantity: value.plannedQuantity,
    status: "DRAFT",
    createdBy: access.user.id,
    createdAt: now,
    updatedAt: now,
    events: [{ type: "CREATED", userId: access.user.id, at: now }],
  };
  await inboundPlans.insertOne(doc);
  return NextResponse.json(doc, { status: 201 });
}
