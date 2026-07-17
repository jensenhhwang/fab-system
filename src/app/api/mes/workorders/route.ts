import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { collections, getMongoClient } from "@/lib/db";
import type { WorkOrderDoc, BomLine, MaterialAllocationDoc, MaterialFlowEventDoc, Product, TransferOrderDoc } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { fabForProduct, type FabId } from "@/lib/fab-domain";
import { orchestrateM20Agents } from "@/lib/m20-agent-service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const statusParam = searchParams.get("status");
  const fabId = searchParams.get("fabId") as FabId | null;
  const { workOrders } = await collections();

  const filter: Record<string, unknown> = {};
  if (statusParam) filter.status = { $in: statusParam.split(",") as WorkOrderDoc["status"][] };
  if (fabId) filter.fabId = fabId;

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
  const { processCode, product, plannedQty, plannedStart, note, fabId, scope = "FULL_BOM", materialId: pilotMaterialId, requestId } = body as {
    processCode: string;
    product: Product;
    fabId?: FabId;
    plannedQty: number;
    plannedStart?: string;
    note?: string;
    scope?: "FULL_BOM" | "M20_PILOT";
    materialId?: string;
    requestId?: string;
  };

  if (!processCode || !product || !plannedQty || plannedQty <= 0) {
    return NextResponse.json({ error: "processCode, product, plannedQty 필수" }, { status: 400 });
  }
  const resolvedFabId = fabForProduct(product);
  if (fabId && fabId !== resolvedFabId) {
    return NextResponse.json({ error: `${product} 작업지시는 ${resolvedFabId}에만 생성할 수 있습니다.` }, { status: 400 });
  }
  if (scope === "M20_PILOT" && (resolvedFabId !== "M20" || product !== "HBM" || processCode !== "P10" || !pilotMaterialId)) {
    return NextResponse.json({ error: "M20 대표 흐름은 M20/HBM/P10과 대표 자재가 필요합니다." }, { status: 400 });
  }

  const { workOrders, bomTemplates, materials, inventory, materialAllocations, transferOrders, materialFlowEvents } = await collections();

  const templateId = `${processCode}-${product}`;
  const template = await bomTemplates.findOne({ _id: templateId });
  if (!template?.lines.length) return NextResponse.json({ error: `${templateId} BOM 템플릿이 비어 있습니다.` }, { status: 409 });
  if (requestId) {
    const existing = await workOrders.findOne({ requestId });
    if (existing) return NextResponse.json(existing);
  }

  const selectedLines = scope === "M20_PILOT"
    ? template.lines.filter((line) => line.materialId === pilotMaterialId)
    : template.lines;
  if (!selectedLines.length) return NextResponse.json({ error: `${pilotMaterialId}가 ${templateId} BOM에 없습니다.` }, { status: 409 });
  const bomLines: BomLine[] = selectedLines.map(line => ({
    materialId: line.materialId,
    plannedQty: Math.round(line.qtyPerRun * plannedQty * 100) / 100,
    pickedQty: 0,
    consumedQty: 0,
    pickedLots: [],
  }));

  const now = new Date();
  const wo: WorkOrderDoc = {
    _id: `WO-${resolvedFabId}-${randomUUID()}`,
    fabId: resolvedFabId,
    processCode,
    product,
    plannedQty,
    plannedQtyUnit: "RUN",
    scope,
    requestId,
    status: "MATERIAL_WAIT",
    bomLines,
    plannedStart: plannedStart ? new Date(plannedStart) : undefined,
    createdBy: access.user.id,
    createdAt: now,
    updatedAt: now,
    note,
  };

  const materialDocs = bomLines.length
    ? await materials.find({ _id: { $in: bomLines.map((line) => line.materialId) } }).toArray()
    : [];
  const inventoryDocs = bomLines.length
    ? await inventory.find({
        materialId: { $in: bomLines.map((line) => line.materialId) },
        quantity: { $gt: 0 },
        status: { $nin: ["HOLD", "QUARANTINE", "CONSUMED"] },
      }).sort({ quantity: -1 }).toArray()
    : [];
  const unitByMaterial = new Map(materialDocs.map((material) => [material._id, material.unit]));
  const sourceByMaterial = new Map<string, string>();
  for (const row of inventoryDocs) if (!sourceByMaterial.has(row.materialId)) sourceByMaterial.set(row.materialId, row.warehouseId);
  const allocations: MaterialAllocationDoc[] = bomLines.map((line) => ({
    _id: randomUUID(),
    materialId: line.materialId,
    fabId: resolvedFabId,
    quantity: line.plannedQty,
    unit: unitByMaterial.get(line.materialId) ?? "EA",
    status: "PLANNED",
    sourceFacilityId: sourceByMaterial.get(line.materialId) ?? "UNASSIGNED-WMS",
    destinationFacilityId: `FAB-${resolvedFabId}`,
    workOrderId: wo._id,
    source: "MES",
    createdAt: now,
    updatedAt: now,
  }));
  const transfers: TransferOrderDoc[] = allocations.map((allocation) => ({
    _id: randomUUID(),
    allocationId: allocation._id,
    workOrderId: wo._id,
    materialId: allocation.materialId,
    fabId: allocation.fabId,
    quantity: allocation.quantity,
    unit: allocation.unit,
    fromFacilityId: allocation.sourceFacilityId,
    toFacilityId: allocation.destinationFacilityId,
    processCode,
    status: "CREATED",
    requestedAt: now,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }));
  const allocationEvents: MaterialFlowEventDoc[] = transfers.map((transfer) => ({
    _id: randomUUID(),
    materialId: transfer.materialId,
    fabId: transfer.fabId,
    type: "ALLOCATED",
    quantity: transfer.quantity,
    unit: transfer.unit,
    facilityId: transfer.fromFacilityId,
    allocationId: transfer.allocationId,
    transferOrderId: transfer._id,
    workOrderId: wo._id,
    processCode,
    requestId: requestId ? `${requestId}:ALLOCATED:${transfer.materialId}` : undefined,
    sequence: 1,
    occurredAt: now,
    recordedBy: access.user.id,
  }));

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await workOrders.insertOne(wo, { session });
      if (allocations.length) await materialAllocations.insertMany(allocations, { session });
      if (transfers.length) await transferOrders.insertMany(transfers, { session });
      if (allocationEvents.length) await materialFlowEvents.insertMany(allocationEvents, { session });
    });
  } finally {
    await session.endSession();
  }
  if (scope === "M20_PILOT") {
    await orchestrateM20Agents(wo._id, access.user.id);
  }
  return NextResponse.json(wo, { status: 201 });
}
