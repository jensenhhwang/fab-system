import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitSimState } from "@/lib/sim-runner";
import { getBaseLeadTime } from "@/lib/sim-engine";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const ratio = Math.min(Math.max(parseFloat(body.ratio ?? "0.7"), 0.1), 0.9);
  const { simPurchaseOrders, simEvents, inventoryLots, inventoryMovements, materials } = await collections();
  const po = await simPurchaseOrders.findOne({ _id: id });
  if (!po || po.status !== "IN_TRANSIT")
    return NextResponse.json({ error: "PO 없음 또는 이미 처리됨" }, { status: 404 });

  const state = await getOrInitSimState();
  const partQty = Math.round(po.qty * ratio);
  const remQty = po.qty - partQty;
  const now = new Date();
  const lotId = randomUUID();

  await inventoryLots.insertOne({
    _id: lotId, materialId: po.materialId, lotNo: `SIM-PARTIAL-MANUAL-${Date.now()}`,
    quantity: partQty, availableQuantity: partQty, receivedAt: state.simDate,
    qualityStatus: "AVAILABLE", updatedAt: now, simulated: true,
  });
  await inventoryMovements.insertOne({
    _id: randomUUID(), materialId: po.materialId, type: "RECEIPT", quantity: partQty,
    lotId, reason: `수동 부분 GR: ${id}`, userId: "manual", createdAt: now, simulated: true,
  });
  await simPurchaseOrders.updateOne({ _id: id }, { $set: { status: "RECEIVED", actualArrival: state.simDate } });

  if (remQty > 0) {
    const mat = await materials.findOne({ _id: po.materialId });
    const leadDays = getBaseLeadTime(mat?.category ?? "");
    const expectedArrival = new Date(state.simDate);
    expectedArrival.setDate(expectedArrival.getDate() + leadDays);
    const remId = `PO-REM-MANUAL-${Date.now()}-${po.materialId}`;
    await simPurchaseOrders.insertOne({
      _id: remId, materialId: po.materialId, qty: remQty, status: "IN_TRANSIT",
      createdSimDate: state.simDate, expectedArrival, leadTimeDays: leadDays, delayDays: 0, simulated: true,
    });
  }

  await simEvents.insertOne({
    _id: `ev-partial-${Date.now()}`, simDate: state.simDate, type: "PARTIAL_GR",
    materialId: po.materialId, qty: partQty, poId: id,
    note: `수동 부분 입고 ${partQty}/${po.qty}`, simulated: true,
  });

  return NextResponse.json({ ok: true, partQty, remQty });
}
