import { NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getEquipmentCapacity } from "@/lib/equipment-capacity";
import { getM20AgentSnapshot } from "@/lib/m20-agent-service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { workOrders, materialAllocations, transferOrders, materialFlowEvents, handlingUnits, fabMaterialStocks } = await collections();
  const workOrder = await workOrders.findOne({ _id: id });
  if (!workOrder) return NextResponse.json({ error: "WO 없음" }, { status: 404 });
  const [allocations, transfers, events, stocks, equipment, agents] = await Promise.all([
    materialAllocations.find({ workOrderId: id }).sort({ createdAt: 1 }).toArray(),
    transferOrders.find({ workOrderId: id }).sort({ createdAt: 1 }).toArray(),
    materialFlowEvents.find({ workOrderId: id }).sort({ sequence: 1, occurredAt: 1 }).toArray(),
    fabMaterialStocks.find({ fabId: workOrder.fabId, processCode: workOrder.processCode }).toArray(),
    getEquipmentCapacity(workOrder.fabId),
    workOrder.scope === "M20_PILOT" ? getM20AgentSnapshot(workOrder._id) : Promise.resolve(null),
  ]);
  const handlingUnitIds = transfers.flatMap((transfer) => transfer.handlingUnitId ? [transfer.handlingUnitId] : []);
  const handlingUnitDocs = handlingUnitIds.length ? await handlingUnits.find({ _id: { $in: handlingUnitIds } }).toArray() : [];
  return NextResponse.json({ workOrder, allocations, transfers, events, handlingUnits: handlingUnitDocs, stocks, equipment, agents }, {
    headers: { "Cache-Control": "no-store" },
  });
}
