import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { collections, getMongoClient } from "@/lib/db";
import type { MaterialFlowEventType, TransferOrderDoc, TransferOrderStatus } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { canTransitionTransfer } from "@/lib/live-transfer";
import { orchestrateM20Agents } from "@/lib/m20-agent-service";

const EVENT: Record<TransferOrderStatus, MaterialFlowEventType> = {
  CREATED: "ALLOCATED", PICKING: "PICKING_STARTED", STAGED: "STAGED",
  IN_TRANSIT: "DISPATCHED", RECEIVED: "RECEIVED", DELIVERED: "DELIVERED", CANCELLED: "CANCELLED",
};
const SEQUENCE: Record<TransferOrderStatus, number> = {
  CREATED: 1, PICKING: 2, STAGED: 3, IN_TRANSIT: 4, RECEIVED: 5, DELIVERED: 6, CANCELLED: 99,
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(WRITE_ROLES.transferTransition);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json() as {
    status?: TransferOrderStatus;
    eta?: string;
    toLocationId?: string;
    requestId?: string;
    lastPosition?: { x: number; y: number; z: number; progress?: number };
  };
  if (!body.status) return NextResponse.json({ error: "status 필수" }, { status: 400 });
  const nextStatus = body.status;
  const commandId = body.requestId?.trim() || `TRANSFER-${randomUUID()}`;
  const {
    transferOrders, materialFlowEvents, materialAllocations, handlingUnits,
    inventoryLots, inventory, fabMaterialStocks, workOrders,
  } = await collections();
  const existingEvent = await materialFlowEvents.findOne({ requestId: commandId });
  if (existingEvent) {
    return NextResponse.json({ ok: true, idempotent: true, transfer: await transferOrders.findOne({ _id: id }) });
  }
  const transfer = await transferOrders.findOne({ _id: id });
  if (!transfer) return NextResponse.json({ error: "TransferOrder 없음" }, { status: 404 });
  if (!canTransitionTransfer(transfer.status, nextStatus)) {
    return NextResponse.json({ error: `${transfer.status} → ${nextStatus} 전이는 허용되지 않습니다.` }, { status: 409 });
  }
  if (["STAGED", "IN_TRANSIT", "RECEIVED", "DELIVERED"].includes(nextStatus) && (!transfer.handlingUnitId || !transfer.lotId)) {
    return NextResponse.json({ error: `${nextStatus} 전이에는 실제 Lot과 Handling Unit이 필요합니다.` }, { status: 409 });
  }
  if (transfer.status === "PICKING" && nextStatus === "STAGED") {
    const picked = await materialFlowEvents.findOne({ transferOrderId: transfer._id, type: "PICKED" });
    if (!picked) return NextResponse.json({ error: "현장 피킹 완료 확인 후 STAGED로 전환할 수 있습니다." }, { status: 409 });
  }

  const now = new Date();
  const processCode = transfer.processCode ?? "P10";
  const prsLocationId = `FAB-${transfer.fabId}__PRS-${processCode}`;
  const lineLocationId = `FAB-${transfer.fabId}__LINE-${processCode}`;
  const prsStockId = `${transfer.fabId}__${processCode}__PRS__${transfer.materialId}`;
  const lineStockId = `${transfer.fabId}__${processCode}__LINE_SIDE__${transfer.materialId}`;
  const outboundLocationId = `${transfer.fromFacilityId}__M20-PILOT-OUTBOUND`;
  const update: Partial<TransferOrderDoc> = { status: nextStatus, updatedAt: now, version: (transfer.version ?? 0) + 1 };
  if (nextStatus === "PICKING") update.pickedAt = now;
  if (nextStatus === "STAGED") update.stagedAt = now;
  if (nextStatus === "IN_TRANSIT") {
    const eta = body.eta ? new Date(body.eta) : transfer.eta;
    if (!eta || Number.isNaN(eta.getTime()) || eta <= now) {
      return NextResponse.json({ error: "IN_TRANSIT 전이에는 현재 이후 ETA가 필요합니다." }, { status: 400 });
    }
    update.departedAt = now;
    update.eta = eta;
  }
  if (nextStatus === "RECEIVED") {
    update.receivedAt = now;
    update.toLocationId = prsLocationId;
  }
  if (nextStatus === "DELIVERED") {
    update.deliveredAt = now;
    update.toLocationId = body.toLocationId ?? lineLocationId;
  }
  if (body.lastPosition) {
    update.lastPosition = { ...body.lastPosition, progress: body.lastPosition.progress === undefined ? undefined : Math.max(0, Math.min(1, body.lastPosition.progress)) };
    update.telemetryAt = now;
  }

  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const versionFilter = transfer.version === undefined ? { version: { $exists: false } } : { version: transfer.version };
      const result = await transferOrders.updateOne(
        { _id: transfer._id, status: transfer.status, ...versionFilter }, { $set: update }, { session },
      );
      if (!result.modifiedCount) throw new Error("TRANSFER_CHANGED");

      if (nextStatus === "STAGED") {
        const hu = await handlingUnits.updateOne(
          { _id: transfer.handlingUnitId, reservedTransferOrderId: transfer._id, logisticsStatus: "RESERVED" },
          { $set: { logisticsStatus: "STAGED", currentLocationId: outboundLocationId, locationId: outboundLocationId, updatedAt: now }, $inc: { version: 1 } },
          { session },
        );
        if (!hu.modifiedCount) throw new Error("HU_STATE_CHANGED");
      }
      if (nextStatus === "IN_TRANSIT") {
        const stock = await inventory.updateOne(
          { materialId: transfer.materialId, warehouseId: transfer.fromFacilityId, quantity: { $gte: transfer.quantity } },
          { $inc: { quantity: -transfer.quantity } }, { session },
        );
        if (!stock.modifiedCount) throw new Error("INVENTORY_PROJECTION_INSUFFICIENT");
        const hu = await handlingUnits.updateOne(
          { _id: transfer.handlingUnitId, reservedTransferOrderId: transfer._id, logisticsStatus: "STAGED" },
          { $set: { logisticsStatus: "IN_TRANSIT", currentFacilityId: "IN_TRANSIT", currentLocationId: transfer._id, updatedAt: now }, $inc: { version: 1 } },
          { session },
        );
        if (!hu.modifiedCount) throw new Error("HU_STATE_CHANGED");
      }
      if (nextStatus === "RECEIVED") {
        await fabMaterialStocks.updateOne(
          { _id: prsStockId },
          { $inc: { quantity: transfer.quantity }, $set: { updatedAt: now }, $setOnInsert: {
            fabId: transfer.fabId, processCode, locationType: "PRS", locationId: prsLocationId,
            materialId: transfer.materialId, unit: transfer.unit,
          } }, { upsert: true, session },
        );
        const hu = await handlingUnits.updateOne(
          { _id: transfer.handlingUnitId, reservedTransferOrderId: transfer._id, logisticsStatus: "IN_TRANSIT" },
          { $set: { logisticsStatus: "RECEIVED", currentFacilityId: transfer.toFacilityId, currentLocationId: prsLocationId, updatedAt: now }, $inc: { version: 1 } },
          { session },
        );
        if (!hu.modifiedCount) throw new Error("HU_STATE_CHANGED");
      }
      if (nextStatus === "DELIVERED") {
        const prs = await fabMaterialStocks.updateOne(
          { _id: prsStockId, quantity: { $gte: transfer.quantity } },
          { $inc: { quantity: -transfer.quantity }, $set: { updatedAt: now } }, { session },
        );
        if (!prs.modifiedCount) throw new Error("PRS_STOCK_INSUFFICIENT");
        await fabMaterialStocks.updateOne(
          { _id: lineStockId },
          { $inc: { quantity: transfer.quantity }, $set: { updatedAt: now }, $setOnInsert: {
            fabId: transfer.fabId, processCode, locationType: "LINE_SIDE", locationId: lineLocationId,
            materialId: transfer.materialId, unit: transfer.unit,
          } }, { upsert: true, session },
        );
        const hu = await handlingUnits.updateOne(
          { _id: transfer.handlingUnitId, reservedTransferOrderId: transfer._id, logisticsStatus: "RECEIVED" },
          { $set: { logisticsStatus: "LINE_SIDE", currentFacilityId: transfer.toFacilityId, currentLocationId: lineLocationId, locationId: lineLocationId, updatedAt: now }, $inc: { version: 1 } },
          { session },
        );
        if (!hu.modifiedCount) throw new Error("HU_STATE_CHANGED");
        await materialAllocations.updateOne({ _id: transfer.allocationId }, { $set: { status: "RELEASED", updatedAt: now } }, { session });
      }
      if (nextStatus === "CANCELLED") {
        if ((transfer.status === "PICKING" || transfer.status === "STAGED") && transfer.lotId && transfer.handlingUnitId) {
          await inventoryLots.updateOne({ _id: transfer.lotId }, { $inc: { availableQuantity: transfer.quantity }, $set: { updatedAt: now } }, { session });
          await handlingUnits.updateOne(
            { _id: transfer.handlingUnitId, reservedTransferOrderId: transfer._id },
            { $set: {
              logisticsStatus: "STORED", currentFacilityId: transfer.fromFacilityId,
              currentLocationId: transfer.fromLocationId, locationId: transfer.fromLocationId,
              updatedAt: now,
            }, $unset: { reservedWorkOrderId: "", reservedTransferOrderId: "" }, $inc: { version: 1 } },
            { session },
          );
          const wo = transfer.workOrderId ? await workOrders.findOne({ _id: transfer.workOrderId }, { session }) : null;
          if (wo) {
            const bomLines = wo.bomLines.map((line) => line.materialId === transfer.materialId ? {
              ...line, pickedQty: Math.max(0, (line.pickedQty ?? line.actualQty ?? 0) - transfer.quantity),
              actualQty: Math.max(0, (line.actualQty ?? line.pickedQty ?? 0) - transfer.quantity),
              pickedLots: line.pickedLots.filter((picked) => picked.lotId !== transfer.lotId),
            } : line);
            await workOrders.updateOne({ _id: wo._id, bomLines: wo.bomLines }, { $set: { bomLines, updatedAt: now } }, { session });
          }
        }
        await materialAllocations.updateOne({ _id: transfer.allocationId }, { $set: { status: "CANCELLED", updatedAt: now } }, { session });
      }

      await materialFlowEvents.insertOne({
        _id: randomUUID(), materialId: transfer.materialId, fabId: transfer.fabId,
        type: EVENT[nextStatus], quantity: transfer.quantity, unit: transfer.unit,
        facilityId: nextStatus === "RECEIVED" || nextStatus === "DELIVERED" ? transfer.toFacilityId : transfer.fromFacilityId,
        locationId: nextStatus === "STAGED" ? outboundLocationId : nextStatus === "RECEIVED" ? prsLocationId : nextStatus === "DELIVERED" ? lineLocationId : transfer.fromLocationId,
        allocationId: transfer.allocationId, transferOrderId: transfer._id, workOrderId: transfer.workOrderId,
        processCode,
        lotId: transfer.lotId, handlingUnitId: transfer.handlingUnitId, requestId: commandId,
        sequence: SEQUENCE[nextStatus], occurredAt: now, recordedBy: access.user.id,
      }, { session });
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["TRANSFER_CHANGED", "HU_STATE_CHANGED", "INVENTORY_PROJECTION_INSUFFICIENT", "PRS_STOCK_INSUFFICIENT"].includes(code) || (error as { code?: number }).code === 11000) {
      return NextResponse.json({ error: `원장 상태가 변경됐거나 수량이 부족합니다: ${code}` }, { status: 409 });
    }
    throw error;
  } finally {
    await session.endSession();
  }
  if (transfer.workOrderId) {
    const workOrder = await workOrders.findOne({ _id: transfer.workOrderId });
    if (workOrder?.scope === "M20_PILOT") await orchestrateM20Agents(workOrder._id, access.user.id);
  }
  return NextResponse.json({ ok: true, transfer: await transferOrders.findOne({ _id: id }) });
}
