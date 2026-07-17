import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { collections, getMongoClient } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { orchestrateM20Agents } from "@/lib/m20-agent-service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(WRITE_ROLES.materialConsume);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json() as { materialId?: string; requestId?: string };
  if (!body.materialId || !body.requestId?.trim()) {
    return NextResponse.json({ error: "materialId와 requestId 필수" }, { status: 400 });
  }
  const commandId = body.requestId.trim();
  const { workOrders, transferOrders, materialAllocations, materialFlowEvents, handlingUnits, fabMaterialStocks, equipmentAssignments } = await collections();
  const existing = await materialFlowEvents.findOne({ requestId: commandId });
  if (existing) return NextResponse.json({ ok: true, idempotent: true, eventId: existing._id });
  const wo = await workOrders.findOne({ _id: id });
  if (!wo) return NextResponse.json({ error: "WO 없음" }, { status: 404 });
  const assignment = wo.scope === "M20_PILOT"
    ? await equipmentAssignments.findOne({ workOrderId: wo._id, status: "RESERVED" })
    : null;
  if (wo.scope === "M20_PILOT" && (wo.status !== "QUEUED" || !assignment)) {
    return NextResponse.json({ error: "MES Release와 공정 장비 배정이 완료되어야 소비할 수 있습니다." }, { status: 409 });
  }
  const transfer = await transferOrders.findOne({ workOrderId: id, materialId: body.materialId, status: "DELIVERED" });
  if (!transfer?.handlingUnitId) return NextResponse.json({ error: "Line-side 인계가 완료된 TransferOrder/HU가 없습니다." }, { status: 409 });
  const allocation = await materialAllocations.findOne({ _id: transfer.allocationId, status: "RELEASED" });
  if (!allocation) return NextResponse.json({ error: "소비 가능한 Allocation이 없습니다." }, { status: 409 });
  const processCode = transfer.processCode ?? wo.processCode;
  const stockId = `${transfer.fabId}__${processCode}__LINE_SIDE__${transfer.materialId}`;
  const now = new Date();
  const nextBomLines = wo.bomLines.map((line) => line.materialId === transfer.materialId ? {
    ...line,
    consumedQty: Math.round(((line.consumedQty ?? 0) + transfer.quantity) * 100) / 100,
  } : line);
  const allConsumed = nextBomLines.every((line) => (line.consumedQty ?? 0) >= line.plannedQty);

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const stock = await fabMaterialStocks.updateOne(
        { _id: stockId, quantity: { $gte: transfer.quantity } },
        { $inc: { quantity: -transfer.quantity }, $set: { updatedAt: now } }, { session },
      );
      if (!stock.modifiedCount) throw new Error("LINE_SIDE_STOCK_INSUFFICIENT");
      const hu = await handlingUnits.updateOne(
        { _id: transfer.handlingUnitId, reservedTransferOrderId: transfer._id, logisticsStatus: "LINE_SIDE" },
        { $set: { logisticsStatus: "CONSUMED", status: "CONSUMED", updatedAt: now }, $inc: { version: 1 } },
        { session },
      );
      if (!hu.modifiedCount) throw new Error("HU_STATE_CHANGED");
      await materialAllocations.updateOne(
        { _id: allocation._id, status: "RELEASED" }, { $set: { status: "CONSUMED", updatedAt: now } }, { session },
      );
      if (assignment) {
        const assignmentResult = await equipmentAssignments.updateOne(
          { _id: assignment._id, status: "RESERVED" },
          { $set: { status: "COMPLETED", updatedAt: now } },
          { session },
        );
        if (!assignmentResult.modifiedCount) throw new Error("EQUIPMENT_ASSIGNMENT_CHANGED");
      }
      const woResult = await workOrders.updateOne(
        { _id: wo._id, bomLines: wo.bomLines },
        { $set: {
          bomLines: nextBomLines, status: allConsumed ? "DONE" : wo.status,
          actualStart: wo.actualStart ?? now, ...(allConsumed ? { actualEnd: now } : {}), updatedAt: now,
        } }, { session },
      );
      if (!woResult.modifiedCount) throw new Error("WORK_ORDER_CHANGED");
      await materialFlowEvents.insertOne({
        _id: randomUUID(), materialId: transfer.materialId, fabId: transfer.fabId,
        type: "CONSUMED", quantity: transfer.quantity, unit: transfer.unit,
        facilityId: transfer.toFacilityId, locationId: transfer.toLocationId,
        allocationId: transfer.allocationId, transferOrderId: transfer._id, workOrderId: wo._id,
        processCode,
        lotId: transfer.lotId, handlingUnitId: transfer.handlingUnitId,
        requestId: commandId, sequence: 7, occurredAt: now, recordedBy: access.user.id,
      }, { session });
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["LINE_SIDE_STOCK_INSUFFICIENT", "HU_STATE_CHANGED", "WORK_ORDER_CHANGED", "EQUIPMENT_ASSIGNMENT_CHANGED"].includes(code) || (error as { code?: number }).code === 11000) {
      return NextResponse.json({ error: `소비 원장이 이미 변경됐거나 수량이 부족합니다: ${code}` }, { status: 409 });
    }
    throw error;
  } finally {
    await session.endSession();
  }
  if (wo.scope === "M20_PILOT") await orchestrateM20Agents(wo._id, access.user.id);
  return NextResponse.json({ ok: true, workOrderId: wo._id, consumedQuantity: transfer.quantity, unit: transfer.unit, done: allConsumed });
}
