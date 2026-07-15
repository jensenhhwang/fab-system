import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import type { WorkOrderDoc, BomLine, Product } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const statusParam = searchParams.get("status");
  const { workOrders } = await collections();

  const filter = statusParam
    ? { status: { $in: statusParam.split(",") as WorkOrderDoc["status"][] } }
    : {};

  const orders = await workOrders
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  return NextResponse.json(orders);
}

export async function POST(req: NextRequest) {
  const access = await requireRole(WRITE_ROLES.workOrderCreate);
  if (access.error) return access.error;
  const body = await req.json();
  const { processCode, product, plannedQty, plannedStart, note } = body as {
    processCode: string;
    product: Product;
    plannedQty: number;
    plannedStart?: string;
    note?: string;
  };

  if (!processCode || !product || !plannedQty || plannedQty <= 0) {
    return NextResponse.json({ error: "processCode, product, plannedQty 필수" }, { status: 400 });
  }

  const { workOrders, bomTemplates } = await collections();

  const templateId = `${processCode}-${product}`;
  const template = await bomTemplates.findOne({ _id: templateId });

  const bomLines: BomLine[] = (template?.lines ?? []).map(line => ({
    materialId: line.materialId,
    plannedQty: Math.round(line.qtyPerRun * plannedQty * 100) / 100,
    pickedLots: [],
  }));

  const now = new Date();
  const wo: WorkOrderDoc = {
    _id: `WO-${Date.now()}`,
    processCode,
    product,
    plannedQty,
    status: "QUEUED",
    bomLines,
    plannedStart: plannedStart ? new Date(plannedStart) : undefined,
    createdBy: access.user.id,
    createdAt: now,
    updatedAt: now,
    note,
  };

  await workOrders.insertOne(wo);
  return NextResponse.json(wo, { status: 201 });
}
