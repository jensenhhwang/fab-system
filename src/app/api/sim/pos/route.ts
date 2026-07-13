import { NextRequest, NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getOrInitSimState } from "@/lib/sim-runner";
import { getBaseLeadTime } from "@/lib/sim-engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const { simPurchaseOrders } = await collections();
  const pos = await simPurchaseOrders
    .find({ status: { $in: ["PENDING", "IN_TRANSIT"] } })
    .sort({ createdSimDate: -1 })
    .toArray();
  return NextResponse.json(pos);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { materialId, qty } = body as { materialId: string; qty: number };
  if (!materialId || !qty || qty <= 0)
    return NextResponse.json({ error: "materialId, qty 필수" }, { status: 400 });

  const { simPurchaseOrders, simEvents, materials } = await collections();
  const state = await getOrInitSimState();
  const mat = await materials.findOne({ _id: materialId });
  const leadDays = getBaseLeadTime(mat?.category ?? "");
  const expectedArrival = new Date(state.simDate);
  expectedArrival.setDate(expectedArrival.getDate() + leadDays);

  const poId = `PO-MANUAL-${Date.now()}-${materialId}`;
  await simPurchaseOrders.insertOne({
    _id: poId, materialId, qty, status: "IN_TRANSIT",
    createdSimDate: state.simDate, expectedArrival,
    leadTimeDays: leadDays, delayDays: 0, simulated: true,
  });
  await simEvents.insertOne({
    _id: poId + "-ev", simDate: state.simDate, type: "MANUAL",
    materialId, qty, poId,
    note: `긴급 발주 ${qty} → D+${leadDays}`, simulated: true,
  });

  return NextResponse.json({ id: poId });
}
