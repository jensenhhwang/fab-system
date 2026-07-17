import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { collections, getMongoClient } from "@/lib/db";
import { requireRole, WRITE_ROLES } from "@/lib/api-auth";
import { fabForProduct } from "@/lib/fab-domain";
import { orchestrateM20Agents, reserveM20PilotMaterial } from "@/lib/m20-agent-service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRole(WRITE_ROLES.workOrderPick);
  if (access.error) return access.error;
  const { id } = await params;
  const body = await req.json() as { materialId?: string; lotId?: string; qty?: number; requestId?: string };
  if (!body.materialId) return NextResponse.json({ error: "materialId 필수" }, { status: 400 });
  const commandId = body.requestId?.trim() || `PICK-${randomUUID()}`;

  const {
    workOrders, inventoryLots, handlingUnits, inventoryMovements,
    materialAllocations, transferOrders, materialFlowEvents,
  } = await collections();
  const existingEvent = await materialFlowEvents.findOne({ requestId: commandId });
  if (existingEvent) return NextResponse.json({ ok: true, idempotent: true, transferOrderId: existingEvent.transferOrderId });

  const wo = await workOrders.findOne({ _id: id });
  if (!wo) return NextResponse.json({ error: "WO 없음" }, { status: 404 });
  if (wo.status !== "QUEUED" && wo.status !== "MATERIAL_WAIT") {
    return NextResponse.json({ error: `피킹 불가 상태: ${wo.status}` }, { status: 409 });
  }
  const line = wo.bomLines.find((item) => item.materialId === body.materialId);
  if (!line) return NextResponse.json({ error: "BOM에 없는 자재" }, { status: 400 });
  const remaining = Math.round((line.plannedQty - (line.pickedQty ?? line.actualQty ?? 0)) * 100) / 100;
  if (remaining <= 0) return NextResponse.json({ error: "이미 전량 피킹된 자재입니다." }, { status: 409 });
  const quantity = body.qty ?? remaining;
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) {
    return NextResponse.json({ error: `피킹 수량은 0 초과 ${remaining} 이하여야 합니다.` }, { status: 400 });
  }
  if (wo.scope === "M20_PILOT" && quantity !== remaining) {
    return NextResponse.json({ error: "M20 대표 흐름은 자재 1종·Lot 1개·HU 1개 전량 피킹만 허용합니다." }, { status: 409 });
  }

  const allocation = await materialAllocations.findOne({
    workOrderId: id, materialId: body.materialId, status: { $in: ["PLANNED", "RESERVED"] },
  });
  if (!allocation) return NextResponse.json({ error: "활성 Allocation이 없습니다." }, { status: 409 });
  let transfer = await transferOrders.findOne({ allocationId: allocation._id, status: { $in: ["CREATED", "PICKING"] } });
  if (!transfer) return NextResponse.json({ error: "피킹 가능한 TransferOrder가 없습니다." }, { status: 409 });

  if (wo.scope === "M20_PILOT") {
    if (transfer.status === "CREATED") {
      try {
        await reserveM20PilotMaterial({ workOrderId: wo._id, actorId: access.user.id });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "FEFO 예약 실패" }, { status: 409 });
      }
      transfer = await transferOrders.findOne({ _id: transfer._id });
    }
    if (!transfer?.lotId || !transfer.handlingUnitId) {
      return NextResponse.json({ error: "WMS 에이전트의 Lot·HU 예약이 필요합니다." }, { status: 409 });
    }
    const alreadyPicked = await materialFlowEvents.findOne({ transferOrderId: transfer._id, type: "PICKED" });
    if (alreadyPicked) return NextResponse.json({ ok: true, idempotent: true, transferOrderId: transfer._id });
    const [lot, handlingUnit] = await Promise.all([
      inventoryLots.findOne({ _id: transfer.lotId }),
      handlingUnits.findOne({ _id: transfer.handlingUnitId, logisticsStatus: "RESERVED", reservedTransferOrderId: transfer._id }),
    ]);
    if (!lot || !handlingUnit) return NextResponse.json({ error: "예약된 Lot·HU 원장이 변경되었습니다." }, { status: 409 });
    const updatedBomLines = wo.bomLines.map((item) => item.materialId === body.materialId ? {
      ...item,
      pickedQty: Math.round(((item.pickedQty ?? item.actualQty ?? 0) + transfer!.quantity) * 100) / 100,
      actualQty: Math.round(((item.pickedQty ?? item.actualQty ?? 0) + transfer!.quantity) * 100) / 100,
      pickedLots: [...item.pickedLots, { lotId: lot._id, qty: transfer!.quantity }],
    } : item);
    const now = new Date();
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await inventoryMovements.insertOne({
          _id: randomUUID(), handlingUnitId: handlingUnit._id, materialId: body.materialId!, type: "PICK",
          fromLocationId: handlingUnit.currentLocationId ?? handlingUnit.locationId, quantity: transfer!.quantity,
          reason: `WMS 피킹 확인: ${wo._id}`, userId: access.user.id, lotId: lot._id,
          processCode: wo.processCode, requestId: commandId, createdAt: now,
        }, { session });
        await materialFlowEvents.insertOne({
          _id: randomUUID(), materialId: body.materialId!, fabId: wo.fabId,
          type: "PICKED", quantity: transfer!.quantity, unit: allocation.unit, facilityId: transfer!.fromFacilityId,
          locationId: handlingUnit.currentLocationId ?? handlingUnit.locationId,
          allocationId: allocation._id, transferOrderId: transfer!._id, workOrderId: wo._id,
          processCode: wo.processCode, lotId: lot._id, handlingUnitId: handlingUnit._id,
          requestId: commandId, sequence: 2, occurredAt: now, recordedBy: access.user.id,
        }, { session });
        const woResult = await workOrders.updateOne(
          { _id: wo._id, bomLines: wo.bomLines },
          { $set: { bomLines: updatedBomLines, status: "MATERIAL_WAIT", updatedAt: now } },
          { session },
        );
        if (!woResult.modifiedCount) throw new Error("PILOT_WORK_ORDER_CHANGED");
        await transferOrders.updateOne(
          { _id: transfer!._id, status: "PICKING" },
          { $set: { pickedAt: now, updatedAt: now } },
          { session },
        );
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000 || (error instanceof Error && error.message === "PILOT_WORK_ORDER_CHANGED")) {
        return NextResponse.json({ error: "피킹 확인이 이미 처리됐거나 원장이 변경되었습니다." }, { status: 409 });
      }
      throw error;
    } finally {
      await session.endSession();
    }
    await orchestrateM20Agents(wo._id, access.user.id);
    return NextResponse.json({
      ok: true, workOrderId: wo._id, allocationId: allocation._id, transferOrderId: transfer._id,
      lotId: lot._id, handlingUnitId: handlingUnit._id, quantity: transfer.quantity, unit: allocation.unit,
      physicalConfirmation: true,
    });
  }

  const lotFilter = { _id: body.lotId, materialId: body.materialId, qualityStatus: "AVAILABLE" as const, availableQuantity: { $gte: quantity } };
  const lot = await inventoryLots.findOne(lotFilter, { sort: { expiryDate: 1, receivedAt: 1 } });
  if (!lot?.warehouseId) return NextResponse.json({ error: "FEFO 가용 Lot 또는 보관 창고가 없습니다." }, { status: 409 });
  const warehouseId = lot.warehouseId;
  const handlingUnit = await handlingUnits.findOne({
    inventoryLotId: lot._id,
    materialId: body.materialId,
    status: "AVAILABLE",
    quantity,
    $or: [{ logisticsStatus: "STORED" }, { logisticsStatus: { $exists: false } }],
  });
  if (!handlingUnit) {
    return NextResponse.json({ error: `Lot ${lot.lotNo}에 정확히 ${quantity}${allocation.unit}인 가용 HU가 없습니다.` }, { status: 409 });
  }

  const now = new Date();
  const updatedBomLines = wo.bomLines.map((item) => item.materialId === body.materialId ? {
    ...item,
    pickedQty: Math.round(((item.pickedQty ?? item.actualQty ?? 0) + quantity) * 100) / 100,
    actualQty: Math.round(((item.pickedQty ?? item.actualQty ?? 0) + quantity) * 100) / 100,
    pickedLots: [...item.pickedLots, { lotId: lot._id, qty: quantity }],
  } : item);
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const lotResult = await inventoryLots.updateOne(
        { _id: lot._id, qualityStatus: "AVAILABLE", availableQuantity: { $gte: quantity } },
        { $inc: { availableQuantity: -quantity }, $set: { updatedAt: now } },
        { session },
      );
      if (!lotResult.modifiedCount) throw new Error("PILOT_STOCK_CHANGED");
      const versionFilter = handlingUnit.version === undefined ? { version: { $exists: false } } : { version: handlingUnit.version };
      const huResult = await handlingUnits.updateOne(
        { _id: handlingUnit._id, status: "AVAILABLE", ...versionFilter, $or: [{ logisticsStatus: "STORED" }, { logisticsStatus: { $exists: false } }] },
        { $set: {
          logisticsStatus: "RESERVED", currentFacilityId: warehouseId,
          currentLocationId: handlingUnit.currentLocationId ?? handlingUnit.locationId,
          reservedWorkOrderId: wo._id, reservedTransferOrderId: transfer._id,
          version: (handlingUnit.version ?? 0) + 1, updatedAt: now,
        } },
        { session },
      );
      if (!huResult.modifiedCount) throw new Error("PILOT_HU_CHANGED");
      await materialAllocations.updateOne(
        { _id: allocation._id, status: allocation.status },
        { $set: { status: "RESERVED", inventoryLotIds: [lot._id], sourceFacilityId: warehouseId, updatedAt: now } },
        { session },
      );
      const transferVersionFilter = transfer.version === undefined ? { version: { $exists: false } } : { version: transfer.version };
      const transferResult = await transferOrders.updateOne(
        { _id: transfer._id, status: transfer.status, ...transferVersionFilter },
        { $set: {
          status: "PICKING", fromFacilityId: warehouseId,
          fromLocationId: handlingUnit.currentLocationId ?? handlingUnit.locationId,
          lotId: lot._id, handlingUnitId: handlingUnit._id, pickedAt: now,
          version: (transfer.version ?? 0) + 1, updatedAt: now,
        } },
        { session },
      );
      if (!transferResult.modifiedCount) throw new Error("PILOT_TRANSFER_CHANGED");
      await inventoryMovements.insertOne({
        _id: randomUUID(), handlingUnitId: handlingUnit._id, materialId: body.materialId!, type: "PICK",
        fromLocationId: handlingUnit.currentLocationId ?? handlingUnit.locationId, quantity,
        reason: `M20 FEFO 예약·피킹: ${wo._id}`, userId: access.user.id, lotId: lot._id,
        processCode: wo.processCode, requestId: commandId, createdAt: now,
      }, { session });
      await materialFlowEvents.insertOne({
        _id: randomUUID(), materialId: body.materialId!, fabId: wo.fabId ?? fabForProduct(wo.product),
        type: "PICKED", quantity, unit: allocation.unit, facilityId: warehouseId,
        locationId: handlingUnit.currentLocationId ?? handlingUnit.locationId,
        allocationId: allocation._id, transferOrderId: transfer._id, workOrderId: wo._id,
        processCode: wo.processCode,
        lotId: lot._id, handlingUnitId: handlingUnit._id, requestId: commandId, sequence: 2,
        occurredAt: now, recordedBy: access.user.id,
      }, { session });
      const woResult = await workOrders.updateOne(
        { _id: wo._id, status: wo.status, bomLines: wo.bomLines },
        { $set: { bomLines: updatedBomLines, status: "MATERIAL_WAIT", updatedAt: now } },
        { session },
      );
      if (!woResult.modifiedCount) throw new Error("PILOT_WORK_ORDER_CHANGED");
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code.startsWith("PILOT_") || (error as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "동일 자재가 이미 예약됐거나 원장이 변경되었습니다." }, { status: 409 });
    }
    throw error;
  } finally {
    await session.endSession();
  }
  return NextResponse.json({
    ok: true, workOrderId: wo._id, allocationId: allocation._id, transferOrderId: transfer._id,
    lotId: lot._id, handlingUnitId: handlingUnit._id, quantity, unit: allocation.unit,
  });
}
